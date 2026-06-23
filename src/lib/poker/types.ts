/**
 * Pure poker engine types. No Next.js, no Prisma, no I/O.
 * All chip amounts are `bigint` (lamports or USDC base units — the engine is
 * unit-agnostic and just treats them as integers).
 */

export type Suit = "c" | "d" | "h" | "s";
export type Rank =
  | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"
  | "T" | "J" | "Q" | "K" | "A";

/** A card is a two-char code, e.g. "As", "Td", "2c". */
export type Card = `${Rank}${Suit}`;

export type Street = "PREFLOP" | "FLOP" | "TURN" | "RIVER" | "SHOWDOWN";

export type ActionType =
  | "FOLD"
  | "CHECK"
  | "CALL"
  | "BET"
  | "RAISE"
  | "ALL_IN"
  | "POST_SMALL_BLIND"
  | "POST_BIG_BLIND";

/** Action submitted by a player (or the engine for blinds/timeouts). */
export interface PlayerAction {
  seat: number;
  type: ActionType;
  /** For BET/RAISE this is the TOTAL amount the player is putting in this street
   * to reach (i.e. the new `committedThisStreet` target), matching common
   * "raise to" semantics. For CALL/CHECK/FOLD it is ignored. */
  amount?: bigint;
}

export interface SeatState {
  seat: number;
  playerId: string;
  /** Remaining chips behind (not yet in the pot). */
  stack: bigint;
  /** Hole cards. Empty until dealt. */
  holeCards: Card[];
  /** Chips committed by this player on the CURRENT street. */
  committedThisStreet: bigint;
  /** Total chips committed by this player across all streets this hand. */
  committedTotal: bigint;
  hasFolded: boolean;
  isAllIn: boolean;
  /** Whether the seat is active in THIS hand (was dealt in). */
  inHand: boolean;
  /** Whether the player has acted at least once on the current street.
   * Used to determine when a betting round is complete. */
  hasActedThisStreet: boolean;
}

export interface Pot {
  amount: bigint;
  /** Seats eligible to win this pot. */
  eligibleSeats: number[];
  /** All seats that contributed chips to this pot (eligible OR folded). Used to
   * refund a pot that has no eligible winner instead of destroying its chips. */
  contributors: number[];
}

export interface HandConfig {
  handId: string;
  tableId: string;
  smallBlind: bigint;
  bigBlind: bigint;
  /** Index into `seats` array of the dealer button. */
  dealerSeat: number;
}

export interface HandState {
  handId: string;
  tableId: string;
  smallBlind: bigint;
  bigBlind: bigint;
  dealerSeat: number;
  smallBlindSeat: number;
  bigBlindSeat: number;

  street: Street;
  seats: SeatState[];
  /** The full deterministic deck for this hand; engine pops from the end. */
  deck: Card[];
  /** Index of next card to deal from `deck`. */
  deckCursor: number;
  community: Card[];

  /** Seat that must act next, or null if the street/hand is resolved. */
  toActSeat: number | null;
  /** Highest total `committedThisStreet` any player has reached this street. */
  currentBet: bigint;
  /** Size of the last full raise — used to validate minimum raises. */
  lastRaiseSize: bigint;
  /** Seat that made the last aggressive action (bet/raise) this street. */
  lastAggressorSeat: number | null;

  pots: Pot[];
  /** Running total of all chips committed (single pot view). */
  totalPot: bigint;

  isComplete: boolean;
  /** Populated by settleHand. */
  results: HandResult[];
  /** Append-only log of actions applied, for hand history + replay. */
  actionLog: AppliedAction[];
}

export interface AppliedAction {
  seat: number;
  playerId: string;
  type: ActionType;
  amount: bigint;
  street: Street;
}

export interface HandResult {
  seat: number;
  playerId: string;
  amountWon: bigint;
  /** Net for the hand = amountWon - committedTotal. */
  net: bigint;
  handDescription: string;
  /** Hole cards — populated ONLY for non-folded players at a contested showdown;
   * always empty for folded players and for uncontested (everyone-folded) wins. */
  cards: Card[];
  /** Whether this player folded out of the hand (never reveal their cards). */
  hasFolded: boolean;
}

/** Public, redacted view broadcast to everyone (no hole cards unless shown). */
export interface PublicHandState {
  handId: string;
  street: Street;
  community: Card[];
  totalPot: bigint;
  currentBet: bigint;
  toActSeat: number | null;
  dealerSeat: number;
  seats: PublicSeatState[];
  isComplete: boolean;
  results?: HandResult[];
}

export interface PublicSeatState {
  seat: number;
  playerId: string;
  stack: bigint;
  committedThisStreet: bigint;
  hasFolded: boolean;
  isAllIn: boolean;
  inHand: boolean;
  /** Hole cards only present at showdown for non-folded players. */
  holeCards?: Card[];
}

/** Private view for a single player: same as public + their own hole cards. */
export interface PrivateHandState extends PublicHandState {
  yourSeat: number | null;
  yourHoleCards: Card[] | null;
}

export type HandRankCategory =
  | "HIGH_CARD"
  | "PAIR"
  | "TWO_PAIR"
  | "THREE_OF_A_KIND"
  | "STRAIGHT"
  | "FLUSH"
  | "FULL_HOUSE"
  | "FOUR_OF_A_KIND"
  | "STRAIGHT_FLUSH";

export interface HandRanking {
  category: HandRankCategory;
  /** Numeric strength; larger is better. Total-orderable for comparison. */
  score: number;
  /** Tiebreak ranks high-to-low (already embedded in `score`, kept for display). */
  tiebreakers: number[];
  description: string;
  /** The best 5 cards making the hand. */
  bestFive: Card[];
}
