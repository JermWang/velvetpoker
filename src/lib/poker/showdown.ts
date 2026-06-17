/**
 * Showdown & settlement.
 *
 * Distributes each pot to its winner(s). Handles:
 *  - uncontested pots (everyone else folded — no cards revealed)
 *  - split pots (ties) with deterministic odd-chip distribution
 *  - side pots (only eligible seats compete for each pot)
 *  - optional rake taken off the top, in integer basis points
 */

import { compareHands, evaluateHand } from "./evaluator";
import { calculateSidePots } from "./side-pots";
import type { Card, HandRanking, HandResult, HandState, SeatState } from "./types";

export interface SettleOptions {
  /** Rake in basis points (1% = 100 bps). Capped, integer math only. */
  rakeBps?: number;
  /** Hard cap on total rake taken this hand (chip units). */
  rakeCap?: bigint;
}

interface SeatEval {
  seat: number;
  ranking: HandRanking | null; // null if folded / not eligible to show
}

/**
 * Settle the hand. Mutates seat stacks (awards winnings) and returns per-seat
 * results. Also sets state.results, state.totalPot, marks complete.
 */
export function settleHand(
  state: HandState,
  options: SettleOptions = {},
): HandResult[] {
  const community = state.community;
  const pots = calculateSidePots(state.seats);

  // Pre-evaluate each contender's best hand once.
  const evals = new Map<number, SeatEval>();
  for (const seat of state.seats) {
    if (seat.inHand && !seat.hasFolded) {
      const ranking =
        community.length === 5
          ? evaluateHand([...seat.holeCards, ...community])
          : null;
      evals.set(seat.seat, { seat: seat.seat, ranking });
    }
  }

  const winnings = new Map<number, bigint>();
  const descriptions = new Map<number, string>();

  let totalRake = 0n;
  const rakeBps = BigInt(Math.max(0, Math.floor(options.rakeBps ?? 0)));

  for (const pot of pots) {
    let potAmount = pot.amount;

    // Rake only from contested pots that actually go to showdown / are won.
    if (rakeBps > 0n && pot.eligibleSeats.length > 0) {
      let rake = (potAmount * rakeBps) / 10_000n;
      if (options.rakeCap !== undefined) {
        const remainingCap = options.rakeCap - totalRake;
        if (rake > remainingCap) rake = remainingCap < 0n ? 0n : remainingCap;
      }
      potAmount -= rake;
      totalRake += rake;
    }

    const winners = determineWinners(pot.eligibleSeats, evals);
    if (winners.length === 0) continue;

    const share = potAmount / BigInt(winners.length);
    let remainder = potAmount % BigInt(winners.length);

    // Odd chips go to winners closest to the left of the dealer button.
    const ordered = orderBySeatPosition(winners, state.dealerSeat, state.seats);
    for (const seat of ordered) {
      let award = share;
      if (remainder > 0n) {
        award += 1n;
        remainder -= 1n;
      }
      winnings.set(seat, (winnings.get(seat) ?? 0n) + award);
      const ev = evals.get(seat);
      if (ev?.ranking) descriptions.set(seat, ev.ranking.description);
    }
  }

  // Apply winnings to stacks and build results.
  const results: HandResult[] = [];
  for (const seat of state.seats) {
    if (!seat.inHand) continue;
    const won = winnings.get(seat.seat) ?? 0n;
    if (won > 0n) seat.stack += won;
    if (won > 0n || seat.committedTotal > 0n) {
      const ev = evals.get(seat.seat);
      results.push({
        seat: seat.seat,
        playerId: seat.playerId,
        amountWon: won,
        net: won - seat.committedTotal,
        handDescription:
          descriptions.get(seat.seat) ??
          (seat.hasFolded ? "Folded" : ev?.ranking?.description ?? "—"),
        cards: seat.holeCards,
      });
    }
  }

  state.results = results;
  state.street = "SHOWDOWN";
  state.isComplete = true;
  return results;
}

function determineWinners(
  eligibleSeats: number[],
  evals: Map<number, SeatEval>,
): number[] {
  const contenders = eligibleSeats
    .map((s) => evals.get(s))
    .filter((e): e is SeatEval => !!e);

  if (contenders.length === 0) return [];
  // Uncontested: a single eligible player wins regardless of ranking
  // (this is the everyone-folded path where rankings may be null).
  if (contenders.length === 1) return [contenders[0]!.seat];

  // All contenders should have rankings (5 community cards present).
  let best: HandRanking | null = null;
  let winners: number[] = [];
  for (const c of contenders) {
    if (!c.ranking) continue;
    if (!best || compareHands(c.ranking, best) > 0) {
      best = c.ranking;
      winners = [c.seat];
    } else if (compareHands(c.ranking, best) === 0) {
      winners.push(c.seat);
    }
  }
  return winners;
}

/** Order seats by distance clockwise from the dealer (small blind first). */
function orderBySeatPosition(
  seats: number[],
  dealerSeat: number,
  allSeats: SeatState[],
): number[] {
  const order = allSeats.map((s) => s.seat);
  const dealerIdx = order.indexOf(dealerSeat);
  const rotated = [
    ...order.slice(dealerIdx + 1),
    ...order.slice(0, dealerIdx + 1),
  ];
  return [...seats].sort(
    (a, b) => rotated.indexOf(a) - rotated.indexOf(b),
  );
}
