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
import type { ActionType, Card } from "@/lib/poker/types";
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
  deltas: Array<{ playerId: string; net: bigint }>;
  rake: bigint;
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

export class TableRoom {
  readonly config: RoomConfig;
  private seats = new Map<number, RoomSeat>();
  private clientSeeds = new Map<string, string>(); // playerId -> seed for next hand
  private hand: HandState | null = null;
  private handNumber = 0;
  private dealerSeat = 0;
  private serverSeed: string | null = null;
  private serverSeedHash: string | null = null;
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
  }

  // ---- seating -----------------------------------------------------------

  sit(params: {
    playerId: string;
    displayName: string;
    seatNumber: number;
    stack: bigint;
  }): void {
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
    const players = this.eligiblePlayers();
    if (players.length < 2) return;
    this.startHand(players);
  }

  private startHand(players: RoomSeat[]): void {
    this.handNumber += 1;
    const handId = `${this.config.tableId}:${this.handNumber}`;

    // Rotate the button to the next eligible seat.
    this.dealerSeat = this.nextDealerSeat(players);

    // Commit-reveal: publish hash before dealing.
    this.serverSeed = generateServerSeed();
    this.serverSeedHash = hashServerSeed(this.serverSeed);
    const clientSeeds = players
      .map((p) => this.clientSeeds.get(p.playerId))
      .filter((s): s is string => !!s);

    const deck = shuffleDeckFromSeed({
      serverSeed: this.serverSeed,
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
      serverSeedHash: this.serverSeedHash,
      dealerSeat: this.dealerSeat,
    });

    // Persist the Hand + RngProof (commitment published before any reveal).
    void this.onHandStarted?.({
      tableId: this.config.tableId,
      handNumber: this.handNumber,
      dealerSeat: this.dealerSeat,
      smallBlindSeat: this.hand.smallBlindSeat,
      bigBlindSeat: this.hand.bigBlindSeat,
      serverSeedHash: this.serverSeedHash,
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

    const deadline = Date.now() + this.config.actionTimeoutSeconds * 1000;
    this.actionDeadline = deadline;
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
          playerId: r.playerId,
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

    // Sync room stacks from engine result and compute per-player settlement
    // deltas. The engine stack already reflects winnings, so the net change for
    // the hand is (final engine stack − starting room stack). With no rake these
    // deltas sum to zero across players (chip conservation), which is exactly
    // what the balanced ledger transaction requires.
    const deltas: HandSettlement["deltas"] = [];
    for (const es of hand.seats) {
      const roomSeat = this.findSeatByPlayer(es.playerId);
      if (roomSeat) {
        deltas.push({ playerId: es.playerId, net: es.stack - roomSeat.stack });
        roomSeat.stack = es.stack;
        // Bust-out: drop to sitting-out between hands.
        if (roomSeat.stack === 0n) roomSeat.sittingOut = true;
      }
    }

    // Engine MVP path takes no rake (settleHand called with no rakeBps), so the
    // deltas net to zero. When rake is enabled, subtract it here.
    void this.onHandSettled?.({
      handId: hand.handId,
      deltas,
      rake: 0n,
    });

    // Persist final Hand state, results, actions, and reveal the server seed.
    void this.onHandCompleted?.({
      tableId: this.config.tableId,
      handNumber: this.handNumber,
      serverSeed: this.serverSeed ?? "",
      potAmount: hand.totalPot,
      rake: 0n,
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
        return {
          seat: s.seatNumber,
          playerId: s.playerId,
          displayName: s.displayName,
          stack: (es?.stack ?? s.stack).toString(),
          committedThisStreet: (es?.committedThisStreet ?? 0n).toString(),
          hasFolded: es?.hasFolded ?? false,
          isAllIn: es?.isAllIn ?? false,
          inHand: es?.inHand ?? false,
          sittingOut: s.sittingOut,
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
    this.actionDeadline = null;
  }

  get isEmpty(): boolean {
    return this.seats.size === 0;
  }
}
