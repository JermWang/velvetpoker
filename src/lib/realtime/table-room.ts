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

  sit(params: {
    playerId: string;
    displayName: string;
    seatNumber: number;
    stack: bigint;
  }): void {
    // A player may hold only one seat — never multiple.
    if (this.findSeatByPlayer(params.playerId)) {
      this.send(params.playerId, { t: "ERROR", message: "You're already seated" });
      return;
    }
    if (this.seats.has(params.seatNumber)) {
      this.send(params.playerId, { t: "ERROR", message: "Seat taken" });
      return;
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
  }

  /** Add chips to a seated player between hands (top-up/rebuy). */
  topUp(playerId: string, amount: bigint): void {
    const seat = this.findSeatByPlayer(playerId);
    if (seat) {
      seat.stack += amount;
      this.broadcastSeats();
    }
  }

  setSitOut(playerId: string, sitOut: boolean): void {
    const seat = this.findSeatByPlayer(playerId);
    if (seat) {
      seat.sittingOut = sitOut;
      this.broadcastSeats();
    }
  }

  leave(playerId: string): bigint {
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
    if (seat) seat.connected = connected;
  }

  // ---- hand lifecycle ----------------------------------------------------

  private eligiblePlayers(): RoomSeat[] {
    return [...this.seats.values()]
      .filter((s) => !s.sittingOut && s.stack > 0n)
      .sort((a, b) => a.seatNumber - b.seatNumber);
  }

  private maybeStartHand(): void {
    if (this.hand && !this.hand.isComplete) return;
    this.manageBots();
    const players = this.eligiblePlayers();
    if (players.length < 2) return;
    // Demo tables only deal when an active human is in: bots never play alone.
    if (this.config.isDemo && !players.some((p) => !this.isBotSeat(p))) return;
    this.startHand(players);
  }

  // ---- bots (demo tables only) ------------------------------------------

  /** Target seated players to keep a free-play table lively for a lone human. */
  private static readonly DEMO_TARGET_PLAYERS = 3;

  private isBotSeat(s: RoomSeat): boolean {
    return isBotId(s.playerId);
  }

  private humanCount(): number {
    return [...this.seats.values()].filter((s) => !this.isBotSeat(s)).length;
  }

  /**
   * Keep demo tables populated with bots: remove all bots when no human is
   * present (so the table idles), otherwise top up to a small target. Only
   * mutates between hands.
   */
  private manageBots(): void {
    if (!this.config.isDemo) return;
    if (this.hand && !this.hand.isComplete) return;

    let changed = false;

    // Remove all bots when no human is present; otherwise prune busted/sitting-
    // out bots so the table stays fresh.
    const noHumans = this.humanCount() === 0;
    for (const [n, s] of this.seats) {
      if (!this.isBotSeat(s)) continue;
      if (noHumans || s.stack === 0n || s.sittingOut) {
        this.seats.delete(n);
        this.seatTokens.delete(s.playerId);
        changed = true;
      }
    }

    if (!noHumans) {
      const target = Math.min(TableRoom.DEMO_TARGET_PLAYERS, this.config.maxSeats);
      while (this.seats.size < target && this.seats.size < this.config.maxSeats) {
        if (!this.addBot()) break;
        changed = true;
      }
    }

    if (changed) this.broadcastSeats();
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

    // Reveal showdown info.
    const pub = serializePublicState(hand);
    if (pub.results && pub.results.length > 0) {
      this.broadcast({
        t: "SHOWDOWN",
        tableId: this.config.tableId,
        handId: hand.handId,
        results: pub.results.map((r) => ({
          seat: r.seat,
          playerId: this.tokenFor(r.playerId),
          amountWon: r.amountWon.toString(),
          handDescription: r.handDescription,
          cards: r.cards,
        })),
      });
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
      // Bust-out: drop to sitting-out between hands.
      if (roomSeat.stack === 0n) roomSeat.sittingOut = true;
    }

    void this.onHandSettled?.({
      handId: hand.handId,
      deltas,
      rake,
      contributions,
    });

    // Persist final Hand state, results, actions, and reveal the server seed.
    void this.onHandCompleted?.({
      tableId: this.config.tableId,
      handNumber: this.handNumber,
      serverSeed: this.serverSeed ?? "",
      potAmount: hand.totalPot,
      rake,
      results: (pub.results ?? []).map((r) => ({
        seat: r.seat,
        playerId: r.playerId,
        amountWon: r.amountWon,
        handDescription: r.handDescription,
        cards: r.cards,
      })),
      actions: hand.actionLog.map((a) => ({
        seat: a.seat,
        playerId: a.playerId,
        type: a.type,
        amount: a.amount,
        street: a.street,
      })),
    });

    this.broadcastSeats();
    this.broadcastTableState();

    // Briefly pause, then deal the next hand if still enough players.
    setTimeout(() => this.maybeStartHand(), 2500);
  }

  // ---- serialization / broadcast ----------------------------------------

  buildTableState(): WireTableState {
    const pub = this.hand ? serializePublicState(this.hand) : null;
    const seats: WireSeat[] = [...this.seats.values()]
      .sort((a, b) => a.seatNumber - b.seatNumber)
      .map((s) => {
        const es = this.hand?.seats.find((x) => x.playerId === s.playerId);
        const la = this.lastActionBySeat.get(s.seatNumber);
        return {
          seat: s.seatNumber,
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
        };
      });

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
    this.broadcast({
      t: "SEAT_UPDATE",
      tableId: this.config.tableId,
      seats: this.buildTableState().seats,
    });
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
