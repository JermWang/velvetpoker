/**
 * A lightweight heuristic bot for free-play demo tables — just enough to give a
 * lone human a believable opponent. It folds junk, calls reasonable hands,
 * value-bets strong ones, and mixes in randomness. Not a serious solver.
 *
 * Pure given Math.random(): takes the hand state + the bot's seat and returns a
 * legal-ish PlayerAction (the caller validates and falls back on rejection).
 */

import { evaluateHand } from "./evaluator";
import { amountToCall, minRaiseTo, minBet } from "./actions";
import type {
  Card,
  HandRankCategory,
  HandState,
  PlayerAction,
  SeatState,
} from "./types";

export const BOT_ID_PREFIX = "bot:";
export const isBotId = (playerId: string): boolean =>
  playerId.startsWith(BOT_ID_PREFIX);

const CATEGORY_ORDER: HandRankCategory[] = [
  "HIGH_CARD",
  "PAIR",
  "TWO_PAIR",
  "THREE_OF_A_KIND",
  "STRAIGHT",
  "FLUSH",
  "FULL_HOUSE",
  "FOUR_OF_A_KIND",
  "STRAIGHT_FLUSH",
];

const RANKS = "23456789TJQKA";
const rankIndex = (card: Card): number => RANKS.indexOf(card[0]!);

/** Rough preflop strength (0..1) from two hole cards. */
function preflopStrength(hole: Card[]): number {
  if (hole.length < 2) return 0.3;
  const a = rankIndex(hole[0]!);
  const b = rankIndex(hole[1]!);
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  const suited = hole[0]![1] === hole[1]![1];
  const gap = hi - lo;
  let s: number;
  if (a === b) {
    s = 0.55 + (hi / 12) * 0.4; // pairs
  } else {
    s = 0.18 + (hi / 12) * 0.34 + (lo / 12) * 0.12;
    if (suited) s += 0.07;
    if (gap === 1) s += 0.05; // connectors
    if (gap > 4) s -= 0.08;
  }
  return Math.max(0, Math.min(1, s));
}

/** Rough made-hand strength (0..1) given the board. */
function handStrength(state: HandState, seat: SeatState): number {
  const board = state.community;
  if (board.length < 3) return preflopStrength(seat.holeCards);
  const rank = evaluateHand([...seat.holeCards, ...board]);
  const idx = CATEGORY_ORDER.indexOf(rank.category); // 0..8
  let s = 0.2 + (idx / 8) * 0.8;
  // Spread the bottom two categories by their high card so junk folds.
  if (rank.category === "HIGH_CARD") s = 0.1 + ((rank.tiebreakers[0] ?? 0) / 14) * 0.18;
  else if (rank.category === "PAIR") s = 0.32 + ((rank.tiebreakers[0] ?? 0) / 14) * 0.2;
  return Math.max(0, Math.min(1, s));
}

function capToStack(seat: SeatState, target: bigint): bigint {
  const max = seat.committedThisStreet + seat.stack;
  return target > max ? max : target;
}

function betTarget(state: HandState, seat: SeatState, strength: number): bigint {
  const pct = 40n + BigInt(Math.floor(strength * 45)); // ~40–85% pot
  let amt = (state.totalPot * pct) / 100n;
  const min = minBet(state);
  if (amt < min) amt = min;
  return capToStack(seat, seat.committedThisStreet + amt);
}

function raiseTarget(state: HandState, seat: SeatState, strength: number): bigint {
  const pct = 45n + BigInt(Math.floor(strength * 35));
  let target = state.currentBet + (state.totalPot * pct) / 100n;
  const min = minRaiseTo(state);
  if (target < min) target = min;
  return capToStack(seat, target);
}

export function decideBotAction(state: HandState, seat: SeatState): PlayerAction {
  const toCall = amountToCall(state, seat);
  const strength = handStrength(state, seat);
  const r = Math.random();
  const maxTarget = seat.committedThisStreet + seat.stack;

  if (toCall === 0n) {
    // Free to check or bet.
    if (strength > 0.6 && r < 0.55) {
      const target = betTarget(state, seat, strength);
      if (target > seat.committedThisStreet && target <= maxTarget) {
        return { seat: seat.seat, type: "BET", amount: target };
      }
    }
    return { seat: seat.seat, type: "CHECK" };
  }

  // Facing a bet or raise.
  if (strength < 0.3 && r < 0.82) return { seat: seat.seat, type: "FOLD" };
  if (strength > 0.78 && r < 0.42) {
    const target = raiseTarget(state, seat, strength);
    if (target > state.currentBet && target <= maxTarget) {
      return { seat: seat.seat, type: "RAISE", amount: target };
    }
  }
  // Don't stack off with a marginal hand.
  if (strength < 0.45 && toCall >= seat.stack && r < 0.7) {
    return { seat: seat.seat, type: "FOLD" };
  }
  return { seat: seat.seat, type: "CALL" };
}
