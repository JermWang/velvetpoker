/**
 * 7-card Texas Hold'em hand evaluator.
 *
 * Strategy: evaluate all C(7,5)=21 five-card subsets, score each, keep the best.
 * Scores are total-orderable integers so `compareHands` is just numeric compare.
 * This is not the fastest possible evaluator, but it is simple, obviously
 * correct, and fast enough for table play. It is pure and fully testable.
 */

import type {
  Card,
  HandRankCategory,
  HandRanking,
  Rank,
} from "./types";

const RANK_VALUE: Record<Rank, number> = {
  "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
  T: 10, J: 11, Q: 12, K: 13, A: 14,
};

const CATEGORY_VALUE: Record<HandRankCategory, number> = {
  HIGH_CARD: 0,
  PAIR: 1,
  TWO_PAIR: 2,
  THREE_OF_A_KIND: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  FOUR_OF_A_KIND: 7,
  STRAIGHT_FLUSH: 8,
};

const CATEGORY_LABEL: Record<HandRankCategory, string> = {
  HIGH_CARD: "High Card",
  PAIR: "Pair",
  TWO_PAIR: "Two Pair",
  THREE_OF_A_KIND: "Three of a Kind",
  STRAIGHT: "Straight",
  FLUSH: "Flush",
  FULL_HOUSE: "Full House",
  FOUR_OF_A_KIND: "Four of a Kind",
  STRAIGHT_FLUSH: "Straight Flush",
};

function rankOf(card: Card): number {
  return RANK_VALUE[card[0] as Rank];
}
function suitOf(card: Card): string {
  return card[1]!;
}

/** Pack category + up to 5 tiebreakers into one orderable integer. */
function packScore(
  category: HandRankCategory,
  tiebreakers: number[],
): number {
  let score = CATEGORY_VALUE[category];
  for (let i = 0; i < 5; i++) {
    score = score * 16 + (tiebreakers[i] ?? 0);
  }
  return score;
}

/** Score exactly five cards. */
function scoreFive(cards: Card[]): {
  category: HandRankCategory;
  tiebreakers: number[];
} {
  const values = cards.map(rankOf).sort((a, b) => b - a);
  const suits = cards.map(suitOf);

  const isFlush = suits.every((s) => s === suits[0]);

  // Straight detection (incl. wheel A-2-3-4-5).
  const distinct = [...new Set(values)].sort((a, b) => b - a);
  let straightHigh = 0;
  if (distinct.length === 5) {
    if (distinct[0]! - distinct[4]! === 4) {
      straightHigh = distinct[0]!;
    } else if (
      distinct[0] === 14 &&
      distinct[1] === 5 &&
      distinct[2] === 4 &&
      distinct[3] === 3 &&
      distinct[4] === 2
    ) {
      straightHigh = 5; // wheel: 5-high straight
    }
  }

  // Count rank multiplicities.
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  // Sort groups by (count desc, value desc).
  const groups = [...counts.entries()].sort((a, b) =>
    b[1] - a[1] !== 0 ? b[1] - a[1] : b[0] - a[0],
  );
  const shape = groups.map((g) => g[1]); // e.g. [3,2] for full house

  if (isFlush && straightHigh) {
    return { category: "STRAIGHT_FLUSH", tiebreakers: [straightHigh] };
  }
  if (shape[0] === 4) {
    return {
      category: "FOUR_OF_A_KIND",
      tiebreakers: [groups[0]![0], groups[1]![0]],
    };
  }
  if (shape[0] === 3 && shape[1] === 2) {
    return {
      category: "FULL_HOUSE",
      tiebreakers: [groups[0]![0], groups[1]![0]],
    };
  }
  if (isFlush) {
    return { category: "FLUSH", tiebreakers: values };
  }
  if (straightHigh) {
    return { category: "STRAIGHT", tiebreakers: [straightHigh] };
  }
  if (shape[0] === 3) {
    return {
      category: "THREE_OF_A_KIND",
      tiebreakers: [groups[0]![0], groups[1]![0], groups[2]![0]],
    };
  }
  if (shape[0] === 2 && shape[1] === 2) {
    const highPair = Math.max(groups[0]![0], groups[1]![0]);
    const lowPair = Math.min(groups[0]![0], groups[1]![0]);
    return {
      category: "TWO_PAIR",
      tiebreakers: [highPair, lowPair, groups[2]![0]],
    };
  }
  if (shape[0] === 2) {
    return {
      category: "PAIR",
      tiebreakers: [groups[0]![0], groups[1]![0], groups[2]![0], groups[3]![0]],
    };
  }
  return { category: "HIGH_CARD", tiebreakers: values };
}

function combinations5(cards: Card[]): Card[][] {
  const result: Card[][] = [];
  const n = cards.length;
  for (let a = 0; a < n - 4; a++)
    for (let b = a + 1; b < n - 3; b++)
      for (let c = b + 1; c < n - 2; c++)
        for (let d = c + 1; d < n - 1; d++)
          for (let e = d + 1; e < n; e++)
            result.push([cards[a]!, cards[b]!, cards[c]!, cards[d]!, cards[e]!]);
  return result;
}

/**
 * Evaluate the best 5-card hand from 5, 6, or 7 cards.
 */
export function evaluateHand(cards: Card[]): HandRanking {
  if (cards.length < 5 || cards.length > 7) {
    throw new Error(`evaluateHand expects 5-7 cards, got ${cards.length}`);
  }
  const combos = cards.length === 5 ? [cards] : combinations5(cards);

  let best: HandRanking | null = null;
  for (const five of combos) {
    const { category, tiebreakers } = scoreFive(five);
    const score = packScore(category, tiebreakers);
    if (!best || score > best.score) {
      best = {
        category,
        score,
        tiebreakers,
        description: CATEGORY_LABEL[category],
        bestFive: five,
      };
    }
  }
  return best!;
}

/**
 * Compare two hands. Returns >0 if a is better, <0 if b is better, 0 if tie.
 */
export function compareHands(a: HandRanking, b: HandRanking): number {
  return a.score - b.score;
}
