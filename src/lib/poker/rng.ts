/**
 * Verifiable shuffle via commit-reveal.
 *
 * Flow:
 *  1. Server generates a random `serverSeed` and publishes `serverSeedHash`
 *     (sha256 of the seed) BEFORE the hand starts. This commits the server to a
 *     deck it cannot later change.
 *  2. Players may optionally submit `clientSeeds`. These are sorted and folded
 *     into the deck derivation so neither side can unilaterally control the deck.
 *  3. The deck is produced by a deterministic Fisher–Yates shuffle driven by a
 *     SHA-256 keystream over (serverSeed | tableId | handId | sortedClientSeeds).
 *  4. After the hand, the server reveals `serverSeed`; anyone can recompute the
 *     deck and confirm it matches `deckHash`, and that sha256(serverSeed) matches
 *     the previously published `serverSeedHash`.
 *
 * Uses only Node's `crypto` so it runs in tests without any framework.
 */

import { createHash, randomBytes } from "node:crypto";
import type { Card, Rank, Suit } from "./types";

export const ALGORITHM = "velvet-shuffle-sha256-fy-v1";

const RANKS: Rank[] = [
  "2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A",
];
const SUITS: Suit[] = ["c", "d", "h", "s"];

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const r of RANKS) {
    for (const s of SUITS) {
      deck.push(`${r}${s}` as Card);
    }
  }
  return deck;
}

export function generateServerSeed(): string {
  return randomBytes(32).toString("hex");
}

export function hashServerSeed(serverSeed: string): string {
  return sha256Hex(serverSeed);
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export interface DeckDerivationInput {
  serverSeed: string;
  tableId: string;
  handId: string;
  clientSeeds: string[];
}

/**
 * Deterministic keystream: an unbounded sequence of bytes produced by hashing
 * `seed || counter`. Used to drive an unbiased Fisher–Yates shuffle.
 */
function* keystream(seed: string): Generator<number, never, unknown> {
  let counter = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const block = createHash("sha256")
      .update(`${seed}|${counter}`, "utf8")
      .digest();
    for (let i = 0; i < block.length; i++) {
      yield block[i]!;
    }
    counter++;
  }
}

/**
 * Unbiased integer in [0, n) drawn from the keystream via rejection sampling
 * over 4 bytes.
 */
function nextIntBelow(stream: Generator<number>, n: number): number {
  if (n <= 0) throw new Error("n must be positive");
  if (n === 1) return 0;
  // Largest multiple of n that fits in 32 bits, for rejection sampling.
  const limit = Math.floor(0x100000000 / n) * n;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const b0 = stream.next().value;
    const b1 = stream.next().value;
    const b2 = stream.next().value;
    const b3 = stream.next().value;
    const x = (b0 * 0x1000000 + b1 * 0x10000 + b2 * 0x100 + b3) >>> 0;
    if (x < limit) return x % n;
  }
}

export function deriveSeedMaterial(input: DeckDerivationInput): string {
  const sortedClients = [...input.clientSeeds].sort();
  return [
    input.serverSeed,
    input.tableId,
    input.handId,
    sortedClients.join(","),
  ].join("|");
}

/** Deterministically shuffle a fresh deck from the derivation input. */
export function shuffleDeckFromSeed(input: DeckDerivationInput): Card[] {
  const deck = createDeck();
  const stream = keystream(deriveSeedMaterial(input));
  // Fisher–Yates from the top down.
  for (let i = deck.length - 1; i > 0; i--) {
    const j = nextIntBelow(stream, i + 1);
    const tmp = deck[i]!;
    deck[i] = deck[j]!;
    deck[j] = tmp;
  }
  return deck;
}

export function deckHash(deck: Card[]): string {
  return sha256Hex(deck.join(""));
}

export interface ShuffleProof {
  algorithm: string;
  serverSeedHash: string;
  serverSeed: string | null;
  clientSeeds: string[];
  tableId: string;
  handId: string;
  deckHash: string;
}

/**
 * Recompute a deck from a revealed proof and confirm:
 *  - sha256(serverSeed) === serverSeedHash (commitment held)
 *  - recomputed deck hash === proof.deckHash (deck was not altered)
 */
export function verifyShuffleProof(proof: ShuffleProof): {
  ok: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  if (!proof.serverSeed) {
    return { ok: false, reasons: ["serverSeed not yet revealed"] };
  }
  if (hashServerSeed(proof.serverSeed) !== proof.serverSeedHash) {
    reasons.push("serverSeedHash does not match revealed serverSeed");
  }
  const deck = shuffleDeckFromSeed({
    serverSeed: proof.serverSeed,
    tableId: proof.tableId,
    handId: proof.handId,
    clientSeeds: proof.clientSeeds,
  });
  if (deckHash(deck) !== proof.deckHash) {
    reasons.push("recomputed deck hash does not match proof deckHash");
  }
  return { ok: reasons.length === 0, reasons };
}
