/**
 * Texas Hold'em hand state machine. Pure & deterministic.
 *
 * Public surface:
 *   createHand(config, players, deck)  -> initial HandState (blinds posted)
 *   applyAction(state, action)         -> mutated HandState after one action
 *   advanceStreet(state)               -> deal next street (used internally)
 *   settleHand(state, opts)            -> distribute pots (re-exported)
 *   serializePublicState / serializePrivateState
 *
 * The caller (table room) is responsible for persistence, timers, and money
 * ledger movements. The engine only knows about abstract chip stacks.
 */

import { amountToCall, validateAction } from "./actions";
import { settleHand } from "./showdown";
import type {
  AppliedAction,
  Card,
  HandConfig,
  HandState,
  PlayerAction,
  PrivateHandState,
  PublicHandState,
  PublicSeatState,
  SeatState,
  Street,
} from "./types";

export { settleHand } from "./showdown";

export interface SeatInput {
  seat: number;
  playerId: string;
  stack: bigint;
}

const STREET_ORDER: Street[] = ["PREFLOP", "FLOP", "TURN", "RIVER", "SHOWDOWN"];

// ---------------------------------------------------------------------------
// Seat ordering helpers
// ---------------------------------------------------------------------------

function orderedSeats(state: HandState): SeatState[] {
  return [...state.seats].sort((a, b) => a.seat - b.seat);
}

/** Active seats (dealt into this hand) in clockwise order. */
function activeOrder(state: HandState): SeatState[] {
  return orderedSeats(state).filter((s) => s.inHand);
}

function nextActiveAfter(state: HandState, seat: number): SeatState {
  const order = activeOrder(state);
  const idx = order.findIndex((s) => s.seat === seat);
  return order[(idx + 1) % order.length]!;
}

function nonFolded(state: HandState): SeatState[] {
  return state.seats.filter((s) => s.inHand && !s.hasFolded);
}

function ableToAct(state: HandState): SeatState[] {
  return nonFolded(state).filter((s) => !s.isAllIn && s.stack > 0n);
}

/**
 * The next seat that still needs to act this street, scanning clockwise from
 * `fromSeat` (exclusive). Returns null when the betting round is resolved.
 */
function nextToAct(state: HandState, fromSeat: number): number | null {
  const order = activeOrder(state);
  const startIdx = order.findIndex((s) => s.seat === fromSeat);
  for (let i = 1; i <= order.length; i++) {
    const s = order[(startIdx + i) % order.length]!;
    if (s.hasFolded || s.isAllIn || s.stack === 0n) continue;
    const needsToMatch = s.committedThisStreet < state.currentBet;
    if (!s.hasActedThisStreet || needsToMatch) return s.seat;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Hand creation
// ---------------------------------------------------------------------------

export function createHand(
  config: HandConfig,
  players: SeatInput[],
  deck: Card[],
): HandState {
  if (players.length < 2) {
    throw new Error("Need at least 2 players to start a hand");
  }
  const sorted = [...players].sort((a, b) => a.seat - b.seat);

  const seats: SeatState[] = sorted.map((p) => ({
    seat: p.seat,
    playerId: p.playerId,
    stack: p.stack,
    holeCards: [],
    committedThisStreet: 0n,
    committedTotal: 0n,
    hasFolded: false,
    isAllIn: false,
    inHand: true,
    hasActedThisStreet: false,
  }));

  const state: HandState = {
    handId: config.handId,
    tableId: config.tableId,
    smallBlind: config.smallBlind,
    bigBlind: config.bigBlind,
    dealerSeat: config.dealerSeat,
    smallBlindSeat: -1,
    bigBlindSeat: -1,
    street: "PREFLOP",
    seats,
    deck,
    deckCursor: 0,
    community: [],
    toActSeat: null,
    currentBet: 0n,
    lastRaiseSize: config.bigBlind,
    lastAggressorSeat: null,
    pots: [],
    totalPot: 0n,
    isComplete: false,
    results: [],
    actionLog: [],
  };

  const isHeadsUp = seats.length === 2;
  const sb = isHeadsUp
    ? findSeat(state, config.dealerSeat)
    : nextActiveAfter(state, config.dealerSeat);
  const bb = nextActiveAfter(state, sb.seat);
  state.smallBlindSeat = sb.seat;
  state.bigBlindSeat = bb.seat;

  // Deal two hole cards each, starting left of the dealer.
  dealHoleCards(state);

  // Post blinds (engine-driven; not counted as voluntary actions).
  postBlind(state, sb.seat, state.smallBlind, "POST_SMALL_BLIND");
  postBlind(state, bb.seat, state.bigBlind, "POST_BIG_BLIND");
  state.currentBet = state.bigBlind;
  state.lastRaiseSize = state.bigBlind;
  state.lastAggressorSeat = bb.seat;

  // First to act preflop: heads-up SB(=dealer) acts first; otherwise UTG.
  const firstToAct = isHeadsUp
    ? sb.seat
    : nextActiveAfter(state, bb.seat).seat;
  state.toActSeat = firstToAct;

  recomputePots(state);
  return state;
}

function findSeat(state: HandState, seat: number): SeatState {
  const s = state.seats.find((x) => x.seat === seat);
  if (!s) throw new Error(`Seat ${seat} not found`);
  return s;
}

function drawCard(state: HandState): Card {
  const card = state.deck[state.deckCursor];
  if (!card) throw new Error("Deck exhausted");
  state.deckCursor += 1;
  return card;
}

function dealHoleCards(state: HandState): void {
  const order = activeOrder(state);
  // Two passes, one card each pass, starting from SB seat (left of dealer).
  const startIdx = order.findIndex((s) => s.seat === state.dealerSeat);
  for (let round = 0; round < 2; round++) {
    for (let i = 1; i <= order.length; i++) {
      const s = order[(startIdx + i) % order.length]!;
      s.holeCards.push(drawCard(state));
    }
  }
}

function postBlind(
  state: HandState,
  seat: number,
  amount: bigint,
  type: "POST_SMALL_BLIND" | "POST_BIG_BLIND",
): void {
  const s = findSeat(state, seat);
  const post = amount < s.stack ? amount : s.stack;
  s.stack -= post;
  s.committedThisStreet += post;
  s.committedTotal += post;
  if (s.stack === 0n) s.isAllIn = true;
  log(state, s, type, post);
}

// ---------------------------------------------------------------------------
// Applying actions
// ---------------------------------------------------------------------------

export function applyAction(
  state: HandState,
  action: PlayerAction,
): HandState {
  const result = validateAction(state, action);
  if (!result.ok) {
    throw new ActionError(result.error ?? "Invalid action");
  }
  const seat = findSeat(state, action.seat);

  switch (action.type) {
    case "FOLD": {
      seat.hasFolded = true;
      seat.hasActedThisStreet = true;
      log(state, seat, "FOLD", 0n);
      break;
    }
    case "CHECK": {
      seat.hasActedThisStreet = true;
      log(state, seat, "CHECK", 0n);
      break;
    }
    case "CALL": {
      const need = amountToCall(state, seat);
      const pay = need < seat.stack ? need : seat.stack;
      commit(state, seat, pay);
      seat.hasActedThisStreet = true;
      log(state, seat, "CALL", pay);
      break;
    }
    case "BET": {
      const target = action.amount!;
      const add = target - seat.committedThisStreet;
      applyAggressive(state, seat, add, "BET");
      break;
    }
    case "RAISE": {
      const target = action.amount!;
      const add = target - seat.committedThisStreet;
      applyAggressive(state, seat, add, "RAISE");
      break;
    }
    case "ALL_IN": {
      const add = seat.stack;
      // Decide whether this functions as a call or an aggressive shove.
      const newCommitted = seat.committedThisStreet + add;
      if (newCommitted > state.currentBet) {
        applyAggressive(state, seat, add, "ALL_IN");
      } else {
        commit(state, seat, add);
        seat.hasActedThisStreet = true;
        log(state, seat, "ALL_IN", add);
      }
      break;
    }
  }

  recomputePots(state);
  progress(state, action.seat);
  return state;
}

/** Move `amount` from a seat's stack into the pot for this street. */
function commit(state: HandState, seat: SeatState, amount: bigint): void {
  if (amount < 0n) throw new ActionError("Negative commit");
  const pay = amount < seat.stack ? amount : seat.stack;
  seat.stack -= pay;
  seat.committedThisStreet += pay;
  seat.committedTotal += pay;
  if (seat.stack === 0n) seat.isAllIn = true;
}

function applyAggressive(
  state: HandState,
  seat: SeatState,
  add: bigint,
  label: "BET" | "RAISE" | "ALL_IN",
): void {
  const prevBet = state.currentBet;
  commit(state, seat, add);
  const newLevel = seat.committedThisStreet;
  const raiseDelta = newLevel - prevBet;

  if (newLevel > prevBet) {
    state.currentBet = newLevel;
    // A FULL raise (>= the last raise size) reopens betting: everyone still in
    // gets to act again and may re-raise. A short all-in (less than a full
    // raise) raises the amount others must match but does NOT reopen the
    // betting — players who already acted may only call or fold, not re-raise
    // (enforced in validateAction via hasActedThisStreet). nextToAct still
    // forces them to match the new level (committedThisStreet < currentBet).
    const isFullRaise = raiseDelta >= state.lastRaiseSize;
    if (isFullRaise) {
      state.lastRaiseSize = raiseDelta;
      state.lastAggressorSeat = seat.seat;
      for (const s of state.seats) {
        if (s.seat !== seat.seat && s.inHand && !s.hasFolded && !s.isAllIn) {
          s.hasActedThisStreet = false;
        }
      }
    }
  }
  seat.hasActedThisStreet = true;
  log(state, seat, label, add);
}

/**
 * Drive the hand forward after an action: end uncontested hands, advance the
 * street when betting is complete, run out the board when everyone is all-in,
 * and settle at the river / showdown.
 */
function progress(state: HandState, fromSeat: number): void {
  let pivot = fromSeat;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (nonFolded(state).length <= 1) {
      finish(state);
      return;
    }

    const next = nextToAct(state, pivot);
    if (next !== null) {
      state.toActSeat = next;
      return;
    }

    // Betting round complete for this street. If at most one player can still
    // act (everyone else is folded or all-in), no further betting is possible —
    // run the board out to showdown instead of re-prompting the lone player on
    // every street (which previously let them fold an already-decided hand and
    // strand the uncalled chips).
    if (ableToAct(state).length <= 1) {
      finish(state);
      return;
    }

    if (state.street === "RIVER") {
      finish(state);
      return;
    }
    advanceStreet(state);
    pivot = state.dealerSeat; // postflop action starts left of the button
  }
}

function finish(state: HandState): void {
  // Return any uncalled bet to its owner BEFORE building pots. When a betting
  // round closed with one player committed for more than anyone else could match
  // (all others folded or all-in for less), the unmatched excess was never
  // called — it must go back to that player, not form an unwinnable side pot.
  refundUncalledBet(state);

  // Reveal full board only if multiple players remain (a showdown). When
  // everyone folds to one player the board stays as-is.
  if (nonFolded(state).length > 1) {
    while (state.community.length < 5) {
      dealCommunity(state, 1);
    }
  }
  state.toActSeat = null;
  settleHand(state);
  recomputePots(state);
}

/**
 * Return an uncalled bet to its owner. If, on the current street, exactly one
 * player committed more than the next-highest commitment (because everyone else
 * folded or is all-in for less), the difference was never called and is returned
 * to that player. Operates on `committedThisStreet`, so it MUST run before the
 * street resets (i.e. at hand end, never after advanceStreet).
 */
function refundUncalledBet(state: HandState): void {
  const commits = state.seats
    .filter((s) => s.committedThisStreet > 0n)
    .sort((a, b) =>
      a.committedThisStreet < b.committedThisStreet
        ? 1
        : a.committedThisStreet > b.committedThisStreet
          ? -1
          : 0,
    );
  if (commits.length === 0) return;
  const top = commits[0]!;
  const secondHighest = commits[1]?.committedThisStreet ?? 0n;
  const uncalled = top.committedThisStreet - secondHighest;
  if (uncalled <= 0n) return; // top level shared by 2+ players → it was called
  top.stack += uncalled;
  top.committedThisStreet -= uncalled;
  top.committedTotal -= uncalled;
  if (top.stack > 0n) top.isAllIn = false;
}

export function advanceStreet(state: HandState): HandState {
  const idx = STREET_ORDER.indexOf(state.street);
  const nextStreet = STREET_ORDER[idx + 1];
  if (!nextStreet) return state;

  if (nextStreet === "FLOP") dealCommunity(state, 3);
  else if (nextStreet === "TURN") dealCommunity(state, 1);
  else if (nextStreet === "RIVER") dealCommunity(state, 1);

  state.street = nextStreet;
  state.currentBet = 0n;
  state.lastRaiseSize = state.bigBlind;
  state.lastAggressorSeat = null;
  for (const s of state.seats) {
    s.committedThisStreet = 0n;
    if (!s.hasFolded && !s.isAllIn) s.hasActedThisStreet = false;
  }
  return state;
}

function dealCommunity(state: HandState, count: number): void {
  // One burn card per street (as in live play), then deal `count` cards.
  // Deterministic since the deck is fixed and committed via the shuffle proof.
  drawCard(state); // burn
  for (let i = 0; i < count; i++) {
    state.community.push(drawCard(state));
  }
}

function recomputePots(state: HandState): void {
  state.totalPot = state.seats.reduce((sum, s) => sum + s.committedTotal, 0n);
}

function log(
  state: HandState,
  seat: SeatState,
  type: AppliedAction["type"],
  amount: bigint,
): void {
  state.actionLog.push({
    seat: seat.seat,
    playerId: seat.playerId,
    type,
    amount,
    street: state.street,
  });
}

// ---------------------------------------------------------------------------
// Serialization (redacted views)
// ---------------------------------------------------------------------------

export function serializePublicState(state: HandState): PublicHandState {
  const showdown = state.isComplete && nonFolded(state).length > 1;
  const seats: PublicSeatState[] = state.seats.map((s) => ({
    seat: s.seat,
    playerId: s.playerId,
    stack: s.stack,
    committedThisStreet: s.committedThisStreet,
    hasFolded: s.hasFolded,
    isAllIn: s.isAllIn,
    inHand: s.inHand,
    holeCards: showdown && !s.hasFolded ? s.holeCards : undefined,
  }));

  return {
    handId: state.handId,
    street: state.street,
    community: state.community,
    totalPot: state.totalPot,
    currentBet: state.currentBet,
    toActSeat: state.toActSeat,
    dealerSeat: state.dealerSeat,
    seats,
    isComplete: state.isComplete,
    results: state.isComplete ? state.results : undefined,
  };
}

export function serializePrivateState(
  state: HandState,
  playerId: string,
): PrivateHandState {
  const pub = serializePublicState(state);
  const mySeat = state.seats.find((s) => s.playerId === playerId);
  return {
    ...pub,
    yourSeat: mySeat?.seat ?? null,
    yourHoleCards: mySeat ? mySeat.holeCards : null,
  };
}

// ---------------------------------------------------------------------------

export class ActionError extends Error {}
