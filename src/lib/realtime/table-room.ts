/**
 * TableRoom — authoritative in-memory state machine for one poker table.
 *
 * Wraps the pure engine with seating, buy-ins, the verifiable-shuffle commit
 * cycle, action timers, and dealer rotation, and emits ServerEvents through
 * injected `send`/`broadcast` callbacks.
 *
 * Chip stacks are held in memory here for low-latency play. The authoritative
 * money record is the database ledger: `onHandSettled` is the hook where a host
 * process persists per-hand deltas via src/lib/ledger. Buy-ins/cash-outs are
 * likewise expected to be ledger-locked by the caller before being reflected
 * here. Keeping this class engine-pure makes it unit-testable without a DB.
 */

import {
  applyAction,
  createHand,
  serializePublicState,
  amountToCall,
  minRaiseTo,
  type HandState,
  type SeatInput,
} from "@/lib/poker";
import {
  deckHash,
  generateServerSeed,
  hashServerSeed,
  shuffleDeckFromSeed,
  ALGORITHM,
} from "@/lib/poker/rng";
import { randomBytes } from "node:crypto";
import type { ActionType, Card } from "@/lib/poker/types";
import { computeRake } from "@/lib/poker/rake";
import { decideBotAction, isBotId, BOT_ID_PREFIX } from "@/lib/poker/bot";
import type { ServerEvent, WireSeat, WireTableState } from "./events";

export interface RoomConfig {
  tableId: string;
  name: string;
  asset: string;
  smallBlind: bigint;
  bigBlind: bigint;
  maxSeats: number;
  actionTimeoutSeconds: number;
  rakeBps?: number;
  /** Free-play demo table — fills empty seats with heuristic bots. */
  isDemo?: boolean;
}

interface RoomSeat {
  seatNumber: number;
  playerId: string;
  displayName: string;
  stack: bigint;
  sittingOut: boolean;
  connected: boolean;
}

export interface HandSettlement {
  handId: string;
  /** Per-player net change to their table stack, AFTER rake is deducted. */
  deltas: Array<{ playerId: string; net: bigint }>;
  /** Total rake taken from the pot. */
  rake: bigint;
  /** Per-player gross contribution to the pot — basis for referral attribution. */
  contributions: Array<{ playerId: string; amount: bigint }>;
}

/** Emitted when a hand is dealt, for persisting the Hand + RngProof rows. */
export interface HandStartedInfo {
  tableId: string;
  handNumber: number;
  dealerSeat: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  serverSeedHash: string;
  deckHash: string;
  clientSeeds: string[];
  algorithm: string;
}

/** Emitted when a hand completes, for finalizing rows + revealing the seed. */
export interface HandCompletedInfo {
  tableId: string;
  handNumber: number;
  serverSeed: string;
  potAmount: bigint;
  rake: bigint;
  results: Array<{
    seat: number;
    playerId: string;
    amountWon: bigint;
    handDescription: string;
    cards: Card[];
  }>;
  actions: Array<{
    seat: number;
    playerId: string;
    type: ActionType | "POST_SMALL_BLIND" | "POST_BIG_BLIND";
    amount: bigint;
    street: string;
  }>;
}

type SendFn = (playerId: string, event: ServerEvent) => void;
type BroadcastFn = (event: ServerEvent) => void;

// Display names for free-play bots.
const BOT_NAMES = [
  "Ace",
  "Banker",
  "Calliope",
  "Diesel",
  "Echo",
  "Faye",
  "Goldie",
  "Hex",
];

export class TableRoom {
  readonly config: RoomConfig;
  private seats = new Map<number, RoomSeat>();
  private clientSeeds = new Map<string, string>(); // playerId -> seed for next hand
  // Per-table opaque seat tokens so real user ids are never broadcast. Maps the
  // real playerId -> a random token used as the public WireSeat.playerId.
  private seatTokens = new Map<string, string>();
  private botCounter = 0;
  private botTimer: ReturnType<typeof setTimeout> | null = null;
  // Demo only: after a lone human waits this long with no opponents, fill the
  // table with bots so they always get a game (and so testing works solo).
  private botFillTimer: ReturnType<typeof setTimeout> | null = null;
  // On bust, a player keeps their seat for a short window to buy back in before
  // it's freed (keyed by playerId).
  private bustTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // Demo/free-play only: brief window to reconnect (e.g. a page refresh) before a
  // disconnected seat is freed, so an accidental refresh drops you back in.
  private disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Seats with a cash-out in flight — guards against a double refund when an
   *  explicit leave and an abandon-timeout race for the same seat. */
  private settling = new Set<string>();
  // Players who pressed Leave during a live hand: auto-folded the moment it's
  // their turn, then cashed out + freed once the hand settles (you can't lift a
  // stack out of a live pot). They keep watching as a spectator meanwhile.
  private pendingLeave = new Set<string>();
  // The most recent uncontested winner (everyone folded). They may OPTIONALLY
  // reveal their hand via showCards() until the next hand starts. Null otherwise.
  private lastUncontestedWinner: { playerId: string; seat: number; cards: Card[] } | null = null;
  private hand: HandState | null = null;
  private handNumber = 0;
  private dealerSeat = 0;
  // Each seat's most recent voluntary action in the current betting round, keyed
  // by seat number. Cleared on street advance and at the start of each hand so
  // the pods show "what they just did this round" and reset every round.
  private lastActionBySeat = new Map<
    number,
    { action: ActionType; amount: bigint }
  >();
  private serverSeed: string | null = null;
  private serverSeedHash: string | null = null;
  // Pre-committed server seed for the UPCOMING hand (commit-ahead chain): its
  // hash is published a hand early, before that hand's client seeds exist, so
  // the operator cannot grind the deck.
  private committedServerSeed: string | null = null;
  private committedServerSeedHash: string | null = null;
  private actionTimer: ReturnType<typeof setTimeout> | null = null;
  private actionDeadline: number | null = null;

  private send: SendFn;
  private broadcast: BroadcastFn;
  /** Optional hook invoked when a hand settles, for ledger persistence. */
  onHandSettled?: (s: HandSettlement) => void | Promise<void>;
  /** Hook invoked when a hand is dealt, for persisting Hand + RngProof. */
  onHandStarted?: (info: HandStartedInfo) => void | Promise<void>;
  /** Hook invoked when a hand completes, for finalizing rows. */
  onHandCompleted?: (info: HandCompletedInfo) => void | Promise<void>;
  /**
   * Hook to cash a seat's stack back to the ledger when the room must remove a
   * real-money player who disconnected and never returned. Returns true once the
   * ledger cash-out succeeded (then the seat is freed); false keeps the seat +
   * locked funds for a later retry. Demo tables leave this unset.
   */
  onCashOutSeat?: (playerId: string, amount: bigint) => Promise<boolean>;

  constructor(config: RoomConfig, io: { send: SendFn; broadcast: BroadcastFn }) {
    this.config = config;
    this.send = io.send;
    this.broadcast = io.broadcast;
    // Commit the first hand's server seed up front, before anyone is seated.
    this.commitNextSeed();
  }

  /**
   * Generate + commit the server seed for the next hand. The commitment hash is
   * surfaced in table state (so clients see it before submitting that hand's
   * client seeds); the seed itself is revealed only after the hand.
   */
  private commitNextSeed(): void {
    this.committedServerSeed = generateServerSeed();
    this.committedServerSeedHash = hashServerSeed(this.committedServerSeed);
  }

  // ---- seating -----------------------------------------------------------

  /** Whether this player already occupies a seat at the table. */
  hasPlayer(playerId: string): boolean {
    return !!this.findSeatByPlayer(playerId);
  }

  /** Stable per-table opaque token for a player (the public seat identifier). */
  private tokenFor(playerId: string): string {
    let token = this.seatTokens.get(playerId);
    if (!token) {
      token = randomBytes(9).toString("base64url");
      this.seatTokens.set(playerId, token);
    }
    return token;
  }

  /** The opaque token to hand a player so they can recognize their own seat. */
  identityToken(playerId: string): string {
    return this.tokenFor(playerId);
  }

  /**
   * Whether this player is dealt into the current, in-progress hand. Used to
   * block a mid-hand cash-out — their committed chips are live in the pot, and
   * the between-hands room stack isn't yet synced to the engine's live stack.
   */
  isInActiveHand(playerId: string): boolean {
    return (
      !!this.hand &&
      !this.hand.isComplete &&
      this.hand.seats.some((s) => s.playerId === playerId)
    );
  }

  /**
   * Seat a player. Returns true on success, false if the player already holds a
   * seat or the requested seat is taken (an ERROR is sent in those cases). The
   * caller MUST check the result for real-money buy-ins so it can refund the
   * just-locked funds when seating fails (otherwise the lock is orphaned).
   */
  sit(params: {
    playerId: string;
    displayName: string;
    seatNumber: number;
    stack: bigint;
  }): boolean {
    // A player may hold only one seat — never multiple.
    if (this.findSeatByPlayer(params.playerId)) {
      this.send(params.playerId, { t: "ERROR", message: "You're already seated" });
      return false;
    }
    if (this.seats.has(params.seatNumber)) {
      this.send(params.playerId, { t: "ERROR", message: "Seat taken" });
      return false;
    }
    this.seats.set(params.seatNumber, {
      seatNumber: params.seatNumber,
      playerId: params.playerId,
      displayName: params.displayName,
      stack: params.stack,
      sittingOut: false,
      connected: true,
    });
    this.broadcastSeats();
    this.maybeStartHand();
    return true;
  }

  /**
   * Rehydrate seats after a process restart (crash recovery). Stacks come from
   * the ledger — the authoritative record of each player's funds locked at this
   * table — so an interrupted process never strands those funds: the room is
   * rebuilt and players reconnect to their seat + stack. Any hand that was
   * in-flight at crash time is simply voided (the ledger never settled it, so
   * stacks here are the correct pre-hand values).
   *
   * Restored players start DISCONNECTED (they re-activate on JOIN_TABLE) and are
   * assigned to the lowest free seats. No-op once the room has any seats.
   */
  restoreSeats(
    players: Array<{ playerId: string; displayName: string; stack: bigint }>,
  ): void {
    if (this.seats.size > 0) return;
    let seatNumber = 0;
    for (const p of players) {
      if (p.stack <= 0n) continue;
      while (this.seats.has(seatNumber)) seatNumber++;
      if (seatNumber >= this.config.maxSeats) break;
      this.seats.set(seatNumber, {
        seatNumber,
        playerId: p.playerId,
        displayName: p.displayName,
        stack: p.stack,
        sittingOut: false,
        connected: false,
      });
      seatNumber++;
    }
    if (this.seats.size > 0) this.broadcastSeats();
  }

  /** Add chips to a seated player between hands (top-up/rebuy). */
  topUp(playerId: string, amount: bigint): void {
    const seat = this.findSeatByPlayer(playerId);
    if (seat) {
      const wasBusted = seat.stack === 0n;
      seat.stack += amount;
      // Bought back in after busting → return to play.
      if (wasBusted && seat.stack > 0n) {
        seat.sittingOut = false;
        this.cancelBustGrace(playerId);
      }
      this.broadcastSeats();
      // Resume play: a rebuy/top-up between hands must kick off the next hand if
      // the table now has enough active players. Without this the rebuying player
      // gets chips but the table sits idle forever (looks like "rebuy is broken").
      this.maybeStartHand();
    }
  }

  setSitOut(playerId: string, sitOut: boolean): void {
    const seat = this.findSeatByPlayer(playerId);
    if (seat) {
      seat.sittingOut = sitOut;
      this.broadcastSeats();
      // Coming back from sitting out should resume play if enough players are in.
      if (!sitOut) this.maybeStartHand();
    }
  }

  leave(playerId: string): bigint {
    this.cancelBustGrace(playerId);
    this.pendingLeave.delete(playerId);
    const dt = this.disconnectTimers.get(playerId);
    if (dt) {
      clearTimeout(dt);
      this.disconnectTimers.delete(playerId);
    }
    const seat = this.findSeatByPlayer(playerId);
    if (!seat) return 0n;
    // A player in an active hand is marked sitting out and removed after the
    // hand; here (MVP) we remove between hands and return their stack to caller
    // for cash-out laddering through the ledger.
    const returned = seat.stack;
    this.seats.delete(seat.seatNumber);
    this.broadcastSeats();
    // Demo tables: clear the bots once the last human leaves.
    this.manageBots();
    return returned;
  }

  submitClientSeed(playerId: string, seed: string): void {
    // Applied to the NEXT hand (current deck is already committed).
    this.clientSeeds.set(playerId, seed.slice(0, 128));
  }

  setConnected(playerId: string, connected: boolean): void {
    const seat = this.findSeatByPlayer(playerId);
    if (!seat) return;
    seat.connected = connected;
    if (connected) {
      // Reconnected (e.g. a refresh) — cancel any pending disconnect cleanup and
      // resume play if the table now has enough active players.
      const dt = this.disconnectTimers.get(playerId);
      if (dt) {
        clearTimeout(dt);
        this.disconnectTimers.delete(playerId);
      }
    }
    this.broadcastSeats();
    if (connected) this.maybeStartHand();
  }

  /**
   * Demo/free-play: a player's socket dropped. Keep their seat for a short grace
   * so an accidental refresh reconnects them into their hand uninterrupted; free
   * the seat only if they don't come back within the window.
   */
  markDisconnected(playerId: string): void {
    this.setConnected(playerId, false);
    if (this.disconnectTimers.has(playerId)) return;
    const t = setTimeout(() => {
      this.disconnectTimers.delete(playerId);
      const seat = this.findSeatByPlayer(playerId);
      if (seat && !seat.connected) this.leave(playerId);
    }, TableRoom.DISCONNECT_GRACE_MS);
    this.disconnectTimers.set(playerId, t);
  }

  /** A cash-out is starting for this seat; returns false if one is already in
   *  flight (the caller should skip, to avoid double-refunding the same stack). */
  beginSettle(playerId: string): boolean {
    if (this.settling.has(playerId)) return false;
    this.settling.add(playerId);
    return true;
  }
  endSettle(playerId: string): void {
    this.settling.delete(playerId);
  }

  /**
   * Real-money: a player's socket dropped. Hold their seat (funds stay locked)
   * for a grace window so a refresh/brief drop reconnects into the same seat; if
   * they never come back, cash their stack back to their balance and free the
   * seat — an abandoned buy-in is always returned, never stuck at the table.
   * Reconnecting (setConnected(true)) cancels the timer.
   */
  markDisconnectedRealMoney(playerId: string): void {
    this.setConnected(playerId, false);
    if (this.disconnectTimers.has(playerId)) return;
    const t = setTimeout(() => {
      void this.handleAbandon(playerId);
    }, TableRoom.ABANDON_GRACE_MS);
    this.disconnectTimers.set(playerId, t);
  }

  private async handleAbandon(playerId: string): Promise<void> {
    this.disconnectTimers.delete(playerId);
    const seat = this.findSeatByPlayer(playerId);
    if (!seat || seat.connected) return; // gone, or reconnected during the grace
    // Can't settle mid-hand (chips are in the pot); the action timer folds them,
    // so re-arm and retry once the hand is over.
    if (this.isInActiveHand(playerId)) {
      this.markDisconnectedRealMoney(playerId);
      return;
    }
    const amount = seat.stack;
    if (amount > 0n) {
      if (!this.onCashOutSeat) return; // no ledger hook → never strand funds
      if (!this.beginSettle(playerId)) return; // an explicit leave is settling it
      let ok = false;
      try {
        ok = await this.onCashOutSeat(playerId, amount);
      } finally {
        this.endSettle(playerId);
      }
      if (!ok) {
        // Ledger hiccup — keep the seat + locked funds and retry after a grace.
        this.markDisconnectedRealMoney(playerId);
        return;
      }
    }
    this.leave(playerId);
  }

  /**
   * A player pressed Leave during a live hand. Fold them out (now if it's their
   * turn, otherwise the instant it becomes their turn — see requestAction) and
   * queue their seat to be cashed out + freed once the hand settles. They forfeit
   * the hand (leaving does that anyway) and keep watching as a spectator.
   */
  foldAndLeaveAfterHand(playerId: string): void {
    const seat = this.findSeatByPlayer(playerId);
    if (!seat) return;
    this.pendingLeave.add(playerId);
    seat.sittingOut = true;
    const toAct =
      this.hand && !this.hand.isComplete && this.hand.toActSeat != null
        ? this.hand.seats.find((s) => s.seat === this.hand!.toActSeat)
        : null;
    if (toAct && toAct.playerId === playerId) {
      // Their turn right now — fold immediately so the hand moves on.
      this.handleAction(playerId, "FOLD");
    } else {
      this.broadcastSeats();
    }
  }

  /** After a hand settles, cash out + free the seats of anyone who left mid-hand. */
  private async processPendingLeaves(): Promise<void> {
    for (const playerId of [...this.pendingLeave]) {
      this.pendingLeave.delete(playerId);
      const seat = this.findSeatByPlayer(playerId);
      if (!seat) continue;
      const amount = seat.stack;
      if (amount > 0n && this.onCashOutSeat) {
        if (!this.beginSettle(playerId)) {
          this.pendingLeave.add(playerId);
          continue;
        }
        let ok = false;
        try {
          ok = await this.onCashOutSeat(playerId, amount);
        } finally {
          this.endSettle(playerId);
        }
        if (!ok) {
          this.pendingLeave.add(playerId); // ledger hiccup — retry after next hand
          continue;
        }
      }
      this.leave(playerId);
    }
  }

  /** Current table stack for a seated player (0 if not seated). */
  stackOf(playerId: string): bigint {
    return this.findSeatByPlayer(playerId)?.stack ?? 0n;
  }

  // ---- hand lifecycle ----------------------------------------------------

  private eligiblePlayers(): RoomSeat[] {
    // Disconnected players are NOT dealt into a new hand — otherwise they'd bleed
    // blinds while unable to act. They rejoin the next hand on reconnect. (Bots
    // are always "connected".)
    return [...this.seats.values()]
      .filter((s) => !s.sittingOut && s.stack > 0n && s.connected)
      .sort((a, b) => a.seatNumber - b.seatNumber);
  }

  private maybeStartHand(): void {
    if (this.hand && !this.hand.isComplete) return;
    this.manageBots();
    const players = this.eligiblePlayers();
    if (players.length < 2) return;
    // Demo tables keep the game going as long as a real person is at the table —
    // even one who is currently sitting out or just busted. They watch the bots
    // play on and rebuy to rejoin; the table never freezes waiting on them. Bots
    // only stop once every human has left (manageBots then clears them, so
    // eligiblePlayers empties and we return above). This is what makes "the game
    // continues regardless of whether the busted player buys back in" true for
    // free play; real-money tables (no bots) continue via eligiblePlayers alone.
    if (this.config.isDemo && this.humanCount() === 0) return;
    this.startHand(players);
  }

  // ---- bots (demo tables only) ------------------------------------------

  /** Target seated players to keep a free-play table lively for a lone human. */
  // Keep demo tables feeling alive — fill close to full (capped by maxSeats).
  private static readonly DEMO_TARGET_PLAYERS = 5;
  /** Wait this long for real opponents before filling a demo table with bots. */
  private static readonly BOT_FILL_DELAY_MS = 30_000;
  /** Grace for a disconnected demo seat to reconnect (refresh) before it frees. */
  private static readonly DISCONNECT_GRACE_MS = 45_000;
  /** Grace for a disconnected real-money seat before its stack is auto-cashed
   *  out to the player's balance and the seat freed (abandoned buy-in). */
  private static readonly ABANDON_GRACE_MS = 120_000;

  private isBotSeat(s: RoomSeat): boolean {
    return isBotId(s.playerId);
  }

  private humanCount(): number {
    return [...this.seats.values()].filter((s) => !this.isBotSeat(s)).length;
  }

  /** Live count of seated (human) players — for the lobby's occupancy display. */
  occupiedSeatCount(): number {
    return this.humanCount();
  }

  /**
   * First unoccupied seat index, or null if the table is full. Reads the
   * authoritative occupied-seat map directly — NOT buildTableState(), which now
   * emits the full ring (every index present), where "free seat" can't be
   * derived from seat presence.
   */
  firstFreeSeat(): number | null {
    for (let i = 0; i < this.config.maxSeats; i++) {
      if (!this.seats.has(i)) return i;
    }
    return null;
  }

  /**
   * Demo-table bot management. Real players always get priority: a lone human
   * gets BOT_FILL_DELAY_MS for opponents to show up; if none do, the table is
   * filled with bots so they can play. Once enough players are seated the fill
   * timer is cancelled, and when the last human leaves all bots are removed so
   * the table idles. Only mutates between hands.
   */
  private manageBots(): void {
    if (!this.config.isDemo) return;
    if (this.hand && !this.hand.isComplete) return;

    // No humans → idle the table: drop every bot and cancel any pending fill.
    if (this.humanCount() === 0) {
      this.clearBotFill();
      if (this.removeBots(() => true)) this.broadcastSeats();
      return;
    }

    // Enough players to deal already (a 2nd human, or bots are in) — no fill.
    if (this.eligiblePlayers().length >= 2) {
      this.clearBotFill();
      return;
    }

    // A human is waiting with no opponents. Give real players 30s to show up,
    // then fill with bots.
    if (!this.botFillTimer) {
      this.botFillTimer = setTimeout(
        () => this.fillWithBots(),
        TableRoom.BOT_FILL_DELAY_MS,
      );
    }
  }

  private clearBotFill(): void {
    if (this.botFillTimer) {
      clearTimeout(this.botFillTimer);
      this.botFillTimer = null;
    }
  }

  /**
   * Reclaim ONE busted seat (sitting out with a zero stack) to make room for a
   * new player when the table is otherwise full — the "kick if there's a queue"
   * rule. Busted seats have no chips to return (a real-money cash-out of 0 is a
   * no-op), so this just vacates the seat. Returns the freed seat number, or null
   * if there is no busted seat to reclaim. Bots are never evicted here (demo bot
   * count is managed separately).
   */
  evictOneBustedSeat(): number | null {
    const busted = [...this.seats.values()]
      .filter((s) => s.stack === 0n && s.sittingOut && !this.isBotSeat(s))
      .sort((a, b) => a.seatNumber - b.seatNumber)[0];
    if (!busted) return null;
    const seatNumber = busted.seatNumber;
    this.send(busted.playerId, {
      t: "ERROR",
      message: "Your seat was given up — you were out of chips and another player took the seat. Buy in again to keep playing.",
    });
    this.leave(busted.playerId);
    return seatNumber;
  }

  private cancelBustGrace(playerId: string): void {
    const t = this.bustTimers.get(playerId);
    if (t) {
      clearTimeout(t);
      this.bustTimers.delete(playerId);
    }
  }

  /** Remove bot seats matching `pred`; returns true if any were removed. */
  private removeBots(pred: (s: RoomSeat) => boolean): boolean {
    let changed = false;
    for (const [n, s] of this.seats) {
      if (this.isBotSeat(s) && pred(s)) {
        this.seats.delete(n);
        this.seatTokens.delete(s.playerId);
        changed = true;
      }
    }
    return changed;
  }

  /** Timer fired: a lone human still has no opponents — seat bots and deal. */
  private fillWithBots(): void {
    this.botFillTimer = null;
    if (!this.config.isDemo) return;
    if (this.hand && !this.hand.isComplete) return;
    if (this.humanCount() === 0) return; // they left
    if (this.eligiblePlayers().length >= 2) return; // someone showed up

    this.removeBots((s) => s.stack <= 0n); // clear any busted bots first
    while (this.seats.size < TableRoom.DEMO_TARGET_PLAYERS) {
      if (!this.addBot()) break; // table full
    }
    this.broadcastSeats();
    this.maybeStartHand();
  }

  private addBot(): boolean {
    let seatNumber = -1;
    for (let i = 0; i < this.config.maxSeats; i++) {
      if (!this.seats.has(i)) {
        seatNumber = i;
        break;
      }
    }
    if (seatNumber < 0) return false;
    this.botCounter += 1;
    // Stack between ~80 and ~200 big blinds for variety.
    const bb = this.config.bigBlind;
    const stack = bb * BigInt(80 + Math.floor(Math.random() * 121));
    this.seats.set(seatNumber, {
      seatNumber,
      playerId: `${BOT_ID_PREFIX}${this.botCounter}`,
      displayName: BOT_NAMES[(this.botCounter - 1) % BOT_NAMES.length]!,
      stack,
      sittingOut: false,
      connected: true,
    });
    return true;
  }

  /** A bot takes its turn (called on a delay so it feels human). */
  private botAct(seatNumber: number): void {
    if (!this.hand || this.hand.isComplete) return;
    if (this.hand.toActSeat !== seatNumber) return;
    const seat = this.hand.seats.find((s) => s.seat === seatNumber);
    if (!seat || !isBotId(seat.playerId)) return;

    let decided: ActionType = "CHECK";
    let amount: bigint | undefined;
    try {
      const a = decideBotAction(this.hand, seat);
      decided = a.type;
      amount = a.amount ?? undefined;
    } catch {
      /* fall through to the safe fallback below */
    }
    this.handleAction(seat.playerId, decided, amount);

    // If the decided action was rejected, fall back to a guaranteed-legal move.
    if (this.hand && !this.hand.isComplete && this.hand.toActSeat === seatNumber) {
      const toCall = amountToCall(this.hand, seat);
      this.handleAction(seat.playerId, toCall === 0n ? "CHECK" : "CALL");
      if (this.hand && !this.hand.isComplete && this.hand.toActSeat === seatNumber) {
        this.handleAction(seat.playerId, "FOLD");
      }
    }
  }

  private startHand(players: RoomSeat[]): void {
    this.handNumber += 1;
    const handId = `${this.config.tableId}:${this.handNumber}`;

    // Fresh hand: reset per-round action labels and street-change trackers.
    this.lastActionBySeat.clear();
    this.lastStreet = "PREFLOP";
    this.lastCommunityCount = 0;
    // The previous hand's optional-show window closes when a new hand begins.
    this.lastUncontestedWinner = null;

    // Rotate the button to the next eligible seat.
    this.dealerSeat = this.nextDealerSeat(players);

    // Commit-reveal: use the seed committed a hand in advance (its hash was
    // already published in table state), then commit the next hand's seed.
    if (!this.committedServerSeed || !this.committedServerSeedHash) {
      this.commitNextSeed();
    }
    const serverSeed = this.committedServerSeed as string;
    const serverSeedHash = this.committedServerSeedHash as string;
    this.serverSeed = serverSeed;
    this.serverSeedHash = serverSeedHash;
    this.committedServerSeed = null;
    this.committedServerSeedHash = null;
    this.commitNextSeed();
    const clientSeeds = players
      .map((p) => this.clientSeeds.get(p.playerId))
      .filter((s): s is string => !!s);

    const deck = shuffleDeckFromSeed({
      serverSeed,
      tableId: this.config.tableId,
      handId,
      clientSeeds,
    });

    const seatInputs: SeatInput[] = players.map((p) => ({
      seat: p.seatNumber,
      playerId: p.playerId,
      stack: p.stack,
    }));

    this.hand = createHand(
      {
        handId,
        tableId: this.config.tableId,
        smallBlind: this.config.smallBlind,
        bigBlind: this.config.bigBlind,
        dealerSeat: this.dealerSeat,
      },
      seatInputs,
      deck,
    );

    this.broadcast({
      t: "HAND_STARTED",
      tableId: this.config.tableId,
      handId,
      serverSeedHash,
      dealerSeat: this.dealerSeat,
    });

    // Persist the Hand + RngProof (commitment published before any reveal).
    void this.onHandStarted?.({
      tableId: this.config.tableId,
      handNumber: this.handNumber,
      dealerSeat: this.dealerSeat,
      smallBlindSeat: this.hand.smallBlindSeat,
      bigBlindSeat: this.hand.bigBlindSeat,
      serverSeedHash,
      deckHash: deckHash(deck),
      clientSeeds,
      algorithm: ALGORITHM,
    });

    // Deal private cards to each player only.
    for (const s of this.hand.seats) {
      this.send(s.playerId, {
        t: "PRIVATE_CARDS",
        tableId: this.config.tableId,
        handId,
        cards: s.holeCards,
      });
    }

    this.broadcastTableState();
    this.requestAction();
  }

  private nextDealerSeat(players: RoomSeat[]): number {
    const seatNums = players.map((p) => p.seatNumber);
    if (this.handNumber === 1) return seatNums[0]!;
    const after = seatNums.find((n) => n > this.dealerSeat);
    return after ?? seatNums[0]!;
  }

  handleAction(playerId: string, action: ActionType, amount?: bigint): void {
    if (!this.hand || this.hand.isComplete) {
      this.send(playerId, { t: "ERROR", message: "No active hand" });
      return;
    }
    const seat = this.hand.seats.find((s) => s.playerId === playerId);
    if (!seat) {
      this.send(playerId, { t: "ERROR", message: "You are not in this hand" });
      return;
    }
    if (this.hand.toActSeat !== seat.seat) {
      this.send(playerId, { t: "ERROR", message: "Not your turn" });
      return;
    }
    try {
      applyAction(this.hand, { seat: seat.seat, type: action, amount });
    } catch (err) {
      this.send(playerId, {
        t: "ERROR",
        message: err instanceof Error ? err.message : "Invalid action",
        code: "INVALID_ACTION",
      });
      return;
    }
    this.clearTimer();

    // Record this seat's most recent move so every pod shows the prior action
    // (all action sources — human, bot, timeout — funnel through here).
    this.lastActionBySeat.set(seat.seat, { action, amount: amount ?? 0n });

    this.broadcast({
      t: "PLAYER_ACTION_APPLIED",
      tableId: this.config.tableId,
      seat: seat.seat,
      action,
      amount: (amount ?? 0n).toString(),
    });
    this.broadcast({
      t: "POT_UPDATE",
      tableId: this.config.tableId,
      totalPot: this.hand.totalPot.toString(),
    });

    if (this.hand.isComplete) {
      this.completeHand();
    } else {
      this.broadcastCommunityIfNeeded();
      this.broadcastTableState();
      this.requestAction();
    }
  }

  private lastCommunityCount = 0;
  private lastStreet = "PREFLOP";
  private broadcastCommunityIfNeeded(): void {
    if (!this.hand) return;
    if (
      this.hand.community.length !== this.lastCommunityCount ||
      this.hand.street !== this.lastStreet
    ) {
      this.lastCommunityCount = this.hand.community.length;
      this.lastStreet = this.hand.street;
      // New betting round — clear everyone's prior-round action labels.
      this.lastActionBySeat.clear();
      if (this.hand.community.length > 0) {
        this.broadcast({
          t: "COMMUNITY_CARDS",
          tableId: this.config.tableId,
          street: this.hand.street,
          cards: this.hand.community,
        });
      }
    }
  }

  private requestAction(): void {
    if (!this.hand || this.hand.toActSeat === null) return;
    const seat = this.hand.seats.find((s) => s.seat === this.hand!.toActSeat);
    if (!seat) return;

    // A player who pressed Leave mid-hand auto-folds the instant it's their turn
    // — no waiting on their clock — so the table never stalls on someone who's
    // already gone (they forfeit, which is the point of leaving).
    if (this.pendingLeave.has(seat.playerId)) {
      this.handleAction(seat.playerId, "FOLD");
      return;
    }

    // Bots have no client to prompt — they act on a short, human-feeling delay.
    if (isBotId(seat.playerId)) {
      const seatNumber = seat.seat;
      this.botTimer = setTimeout(
        () => this.botAct(seatNumber),
        650 + Math.floor(Math.random() * 1100),
      );
      return;
    }

    const deadline = Date.now() + this.config.actionTimeoutSeconds * 1000;
    this.actionDeadline = deadline;
    // Re-broadcast now that the deadline is set, so every client can render this
    // seat's live countdown — not only the player being prompted below.
    this.broadcastTableState();
    this.send(seat.playerId, {
      t: "ACTION_REQUIRED",
      tableId: this.config.tableId,
      seat: seat.seat,
      toCall: amountToCall(this.hand, seat).toString(),
      minRaiseTo: minRaiseTo(this.hand).toString(),
      deadline,
    });

    this.actionTimer = setTimeout(() => {
      this.onActionTimeout(seat.playerId);
    }, this.config.actionTimeoutSeconds * 1000);
  }

  /**
   * On reconnect mid-hand, re-send the player's private cards and — if it's
   * their turn — the action prompt with the REMAINING deadline (no timer reset),
   * so a page refresh doesn't blind them into a timeout-fold.
   */
  resyncPlayer(playerId: string): void {
    if (!this.hand) return;
    const seat = this.hand.seats.find((s) => s.playerId === playerId);
    if (!seat || !seat.inHand) return;
    this.send(playerId, {
      t: "PRIVATE_CARDS",
      tableId: this.config.tableId,
      handId: this.hand.handId,
      cards: seat.holeCards,
    });
    if (this.hand.toActSeat === seat.seat && this.actionDeadline) {
      this.send(playerId, {
        t: "ACTION_REQUIRED",
        tableId: this.config.tableId,
        seat: seat.seat,
        toCall: amountToCall(this.hand, seat).toString(),
        minRaiseTo: minRaiseTo(this.hand).toString(),
        deadline: this.actionDeadline,
      });
    }
  }

  /**
   * Optional show: the most recent uncontested winner voluntarily reveals their
   * hand to the table. One-time, and only the winner can trigger it.
   */
  showCards(playerId: string): void {
    const w = this.lastUncontestedWinner;
    if (!w || w.playerId !== playerId) return;
    this.lastUncontestedWinner = null; // one-time reveal
    this.broadcast({
      t: "SHOWN_CARDS",
      tableId: this.config.tableId,
      seat: w.seat,
      playerId: this.tokenFor(w.playerId),
      displayName: this.findSeatByPlayer(w.playerId)?.displayName ?? "Player",
      cards: w.cards,
    });
  }

  private onActionTimeout(playerId: string): void {
    if (!this.hand) return;
    const seat = this.hand.seats.find((s) => s.playerId === playerId);
    if (!seat || this.hand.toActSeat !== seat.seat) return;
    // Time-out: check if free, otherwise fold.
    const canCheck = amountToCall(this.hand, seat) === 0n;
    this.handleAction(playerId, canCheck ? "CHECK" : "FOLD");
  }

  private completeHand(): void {
    if (!this.hand) return;
    this.clearTimer();
    const hand = this.hand;

    // Reveal showdown info. Hole cards are ONLY revealed at a contested showdown
    // (two or more hands shown). On an uncontested win — everyone folded to one
    // player — that player mucks unseen, so we never put their cards on the wire.
    const pub = serializePublicState(hand);
    if (pub.results && pub.results.length > 0) {
      // A contested showdown means two or more NON-folded players reached the
      // end. Counting all result rows (which include folded contributors) would
      // both mislabel an uncontested win and — combined with r.cards — leak a
      // folded player's hole cards. The engine already redacts r.cards for
      // folded / non-showdown players; the !r.hasFolded guard is belt-and-braces.
      const contested =
        pub.results.filter((r) => !r.hasFolded).length > 1;
      this.broadcast({
        t: "SHOWDOWN",
        tableId: this.config.tableId,
        handId: hand.handId,
        results: pub.results.map((r) => ({
          seat: r.seat,
          playerId: this.tokenFor(r.playerId),
          amountWon: r.amountWon.toString(),
          handDescription: contested && !r.hasFolded ? r.handDescription : r.hasFolded ? "Folded" : "Won uncontested",
          cards: contested && !r.hasFolded ? r.cards : [],
        })),
      });

      // Uncontested win (everyone folded): the winner mucked unseen, but may
      // OPTIONALLY reveal their hand (SHOW_CARDS) until the next hand starts.
      this.lastUncontestedWinner = null;
      if (!contested) {
        const winner = hand.seats.find((s) => s.inHand && !s.hasFolded);
        if (winner && !isBotId(winner.playerId)) {
          this.lastUncontestedWinner = {
            playerId: winner.playerId,
            seat: winner.seat,
            cards: winner.holeCards,
          };
        }
      }
    }

    // Reveal server seed so anyone can verify the deck.
    this.broadcast({
      t: "HAND_COMPLETE",
      tableId: this.config.tableId,
      handId: hand.handId,
      serverSeed: this.serverSeed ?? "",
    });

    // ---- Rake -------------------------------------------------------------
    // Take the house fee out of the pot ("no flop, no drop"), apportioned across
    // winners by what they collected so it comes out exactly once. Per-player
    // gross contributions are recorded for downstream referral attribution.
    const pot = hand.totalPot;
    const flopSeen = (pub.community?.length ?? 0) >= 3;
    const rake = computeRake({
      pot,
      rakeBps: this.config.rakeBps ?? 0,
      bigBlind: this.config.bigBlind,
      flopSeen,
    });

    const wonByPlayer = new Map<string, bigint>();
    for (const r of pub.results ?? []) {
      wonByPlayer.set(r.playerId, (wonByPlayer.get(r.playerId) ?? 0n) + r.amountWon);
    }

    const rakeByPlayer = new Map<string, bigint>();
    if (rake > 0n && pot > 0n) {
      let distributed = 0n;
      let topPlayer: string | null = null;
      let topWon = -1n;
      for (const [playerId, won] of wonByPlayer) {
        if (won <= 0n) continue;
        const share = (rake * won) / pot;
        rakeByPlayer.set(playerId, share);
        distributed += share;
        if (won > topWon) {
          topWon = won;
          topPlayer = playerId;
        }
      }
      // The biggest winner absorbs the rounding remainder so the total taken
      // equals `rake` exactly.
      const remainder = rake - distributed;
      if (remainder > 0n && topPlayer) {
        rakeByPlayer.set(topPlayer, (rakeByPlayer.get(topPlayer) ?? 0n) + remainder);
      }
    }

    // Sync room stacks (net of rake) and compute post-rake deltas + the gross
    // pot contribution per player. contribution = start − end + winnings.
    const deltas: HandSettlement["deltas"] = [];
    const contributions: HandSettlement["contributions"] = [];
    for (const es of hand.seats) {
      const roomSeat = this.findSeatByPlayer(es.playerId);
      if (!roomSeat) continue;
      const startStack = roomSeat.stack;
      const won = wonByPlayer.get(es.playerId) ?? 0n;
      const contribution = startStack - es.stack + won;
      if (contribution > 0n) {
        contributions.push({ playerId: es.playerId, amount: contribution });
      }

      const rakeShare = rakeByPlayer.get(es.playerId) ?? 0n;
      const finalStack = es.stack - rakeShare;
      deltas.push({ playerId: es.playerId, net: finalStack - startStack });
      roomSeat.stack = finalStack;
      // Bust-out handling:
      //  - Bots just leave when they run out (fresh bots refill empty seats).
      //  - Humans KEEP their seat (sitting out) so they can rebuy at will (free
      //    play OR wagered, public OR private), with no time limit. The seat is
      //    only reclaimed if a NEW player needs it and the table is full (see
      //    evictOneBustedSeat). No queue waiting → keep your seat and rebuy.
      if (roomSeat.stack === 0n) {
        if (this.isBotSeat(roomSeat)) {
          this.seats.delete(roomSeat.seatNumber);
          this.seatTokens.delete(roomSeat.playerId);
        } else {
          roomSeat.sittingOut = true;
        }
      }
    }

    // Settle the hand, THEN cash out + free anyone who left mid-hand (their stack
    // is only final once the deltas are applied). Ordering matters for the ledger.
    void Promise.resolve(
      this.onHandSettled?.({
        handId: hand.handId,
        deltas,
        rake,
        contributions,
      }),
    )
      .then(() => this.processPendingLeaves())
      .catch((e) => console.error("[room] settle / pending-leave error", e));

    // Persist final Hand state, results, actions, and reveal the server seed.
    void this.onHandCompleted?.({
      tableId: this.config.tableId,
      handNumber: this.handNumber,
      serverSeed: this.serverSeed ?? "",
      potAmount: hand.totalPot,
      rake,
      // Persist hole cards ONLY for non-folded players at a contested showdown —
      // an uncontested win mucks unseen and a folded player NEVER reveals, so
      // their cards are never stored (matches the wire). r.cards is already
      // redacted by the engine; the guards here are defense-in-depth.
      results: (pub.results ?? []).map((r) => {
        const contested =
          (pub.results ?? []).filter((x) => !x.hasFolded).length > 1;
        return {
          seat: r.seat,
          playerId: r.playerId,
          amountWon: r.amountWon,
          handDescription: r.handDescription,
          cards: contested && !r.hasFolded ? r.cards : [],
        };
      }),
      actions: hand.actionLog.map((a) => ({
        seat: a.seat,
        playerId: a.playerId,
        type: a.type,
        amount: a.amount,
        street: a.street,
      })),
    });

    this.broadcastTableState();

    // Briefly pause, then deal the next hand if still enough players.
    setTimeout(() => this.maybeStartHand(), 2500);
  }

  // ---- serialization / broadcast ----------------------------------------

  buildTableState(): WireTableState {
    const pub = this.hand ? serializePublicState(this.hand) : null;
    // Emit the FULL seat ring (0 .. maxSeats-1), not just occupied seats, so the
    // client can render every position and offer the open ones to sit. Empty
    // seats carry a null playerId.
    const occupied = new Map(
      [...this.seats.values()].map((s) => [s.seatNumber, s] as const),
    );
    const seats: WireSeat[] = [];
    for (let i = 0; i < this.config.maxSeats; i++) {
      const s = occupied.get(i);
      if (!s) {
        seats.push({
          seat: i,
          playerId: null,
          displayName: null,
          stack: "0",
          committedThisStreet: "0",
          hasFolded: false,
          isAllIn: false,
          inHand: false,
          sittingOut: false,
          lastAction: null,
        });
        continue;
      }
      const es = this.hand?.seats.find((x) => x.playerId === s.playerId);
      const la = this.lastActionBySeat.get(s.seatNumber);
      seats.push({
        seat: i,
        // Opaque per-table token, never the real user id (privacy).
        playerId: this.tokenFor(s.playerId),
        displayName: s.displayName,
        stack: (es?.stack ?? s.stack).toString(),
        committedThisStreet: (es?.committedThisStreet ?? 0n).toString(),
        hasFolded: es?.hasFolded ?? false,
        isAllIn: es?.isAllIn ?? false,
        inHand: es?.inHand ?? false,
        sittingOut: s.sittingOut,
        lastAction: la
          ? { action: la.action, amount: la.amount.toString() }
          : null,
      });
    }

    return {
      tableId: this.config.tableId,
      name: this.config.name,
      status: this.hand && !this.hand.isComplete ? "ACTIVE" : "WAITING",
      asset: this.config.asset,
      smallBlind: this.config.smallBlind.toString(),
      bigBlind: this.config.bigBlind.toString(),
      street: pub?.street ?? null,
      community: pub?.community ?? [],
      totalPot: (pub?.totalPot ?? 0n).toString(),
      currentBet: (pub?.currentBet ?? 0n).toString(),
      toActSeat: pub?.toActSeat ?? null,
      dealerSeat: this.hand ? this.dealerSeat : null,
      actionDeadline: this.actionDeadline,
      seats,
      handId: this.hand?.handId ?? null,
      serverSeedHash: this.serverSeedHash,
      nextServerSeedHash: this.committedServerSeedHash,
    };
  }

  broadcastTableState(): void {
    this.broadcast({ t: "TABLE_STATE", state: this.buildTableState() });
  }

  sendTableState(playerId: string): void {
    this.send(playerId, { t: "TABLE_STATE", state: this.buildTableState() });
  }

  private broadcastSeats(): void {
    // Send a FULL TABLE_STATE, not a partial SEAT_UPDATE. A client that hasn't
    // reduced its first TABLE_STATE yet DROPS SEAT_UPDATE on the floor (see
    // use-table-socket reduce()), which could leave a just-seated player
    // invisible to everyone until a hand started — and a hand can't start with
    // < 2 visible players, so two players could be stuck never seeing each
    // other. TABLE_STATE is self-healing: the client accepts it from any state.
    this.broadcastTableState();
  }

  // ---- helpers -----------------------------------------------------------

  private findSeatByPlayer(playerId: string): RoomSeat | undefined {
    return [...this.seats.values()].find((s) => s.playerId === playerId);
  }

  private clearTimer(): void {
    if (this.actionTimer) {
      clearTimeout(this.actionTimer);
      this.actionTimer = null;
    }
    if (this.botTimer) {
      clearTimeout(this.botTimer);
      this.botTimer = null;
    }
    this.actionDeadline = null;
  }

  get isEmpty(): boolean {
    return this.seats.size === 0;
  }
}
