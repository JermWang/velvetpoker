/**
 * Side pot construction.
 *
 * Builds main + side pots from each seat's TOTAL committed chips this hand,
 * accounting for all-ins at different stack depths and for folded players
 * (their chips stay in the pot but they are not eligible to win).
 */

import type { Pot, SeatState } from "./types";

interface Contributor {
  seat: number;
  committed: bigint;
  eligible: boolean; // in the hand and not folded
}

export function calculateSidePots(seats: SeatState[]): Pot[] {
  const contributors: Contributor[] = seats
    .filter((s) => s.committedTotal > 0n)
    .map((s) => ({
      seat: s.seat,
      committed: s.committedTotal,
      eligible: s.inHand && !s.hasFolded,
    }));

  if (contributors.length === 0) return [];

  // Distinct positive contribution levels, ascending.
  const levels = [...new Set(contributors.map((c) => c.committed))].sort(
    (a, b) => (a < b ? -1 : a > b ? 1 : 0),
  );

  const pots: Pot[] = [];
  let prev = 0n;

  for (const level of levels) {
    const layer = level - prev;
    const atOrAbove = contributors.filter((c) => c.committed >= level);
    const amount = layer * BigInt(atOrAbove.length);
    if (amount > 0n) {
      const contributors = atOrAbove.map((c) => c.seat).sort((a, b) => a - b);
      const eligibleSeats = atOrAbove
        .filter((c) => c.eligible)
        .map((c) => c.seat)
        .sort((a, b) => a - b);
      pots.push({ amount, eligibleSeats, contributors });
    }
    prev = level;
  }

  // Merge consecutive pots whose eligible sets are identical (cleaner display,
  // identical settlement result). NEVER merge a pot with no eligible winner —
  // those are refunded to their exact contributors at settlement, so each must
  // retain its own contributor set.
  const merged: Pot[] = [];
  for (const pot of pots) {
    const last = merged[merged.length - 1];
    if (
      last &&
      pot.eligibleSeats.length > 0 &&
      sameSeats(last.eligibleSeats, pot.eligibleSeats)
    ) {
      last.amount += pot.amount;
    } else {
      merged.push({ ...pot });
    }
  }
  return merged;
}

function sameSeats(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
