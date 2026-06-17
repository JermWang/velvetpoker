/**
 * Outcome anchoring — Merkle batching of completed-hand outcomes for on-chain
 * commitment.
 *
 * Each completed hand is reduced to a canonical record (the provable facts:
 * commit/reveal seeds, deck hash, pot/rake, and the per-seat payouts + shown
 * cards) and hashed into a leaf. Many leaves are combined into a Merkle tree and
 * only the ROOT is posted on-chain in a single memo tx — so outcomes/payouts are
 * tamper-evident in one cheap transaction, without publishing per-hand data or
 * player identities on-chain.
 *
 * Anyone can later verify a single hand: recompute its leaf from the canonical
 * record, walk the Merkle proof to the root, and confirm that root matches the
 * one in the on-chain memo. The verify endpoint returns exactly that bundle.
 *
 * Hashing follows an RFC6962-style domain separation (0x00 for leaves, 0x01 for
 * internal nodes) to prevent leaf/node second-preimage confusion.
 */

import { createHash } from "node:crypto";

export const ANCHOR_ALGORITHM = "velvet-anchor-merkle-sha256-v1";
export const ANCHOR_MEMO_PREFIX = "velvet-anchor-v1";

const LEAF_PREFIX = Buffer.from([0x00]);
const NODE_PREFIX = Buffer.from([0x01]);

function sha256(...parts: Buffer[]): Buffer {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest();
}

/** A single hand's payout to one seat (no userId — identity stays off-chain). */
export interface AnchorResultRecord {
  seat: number;
  amountWon: string; // base units as decimal string
  handDescription: string;
  cards: unknown; // shown cards at showdown (already public)
}

/**
 * The canonical, deterministic record for a hand. Field order is fixed; bigints
 * are rendered as decimal strings. Results are sorted by seat so the encoding is
 * independent of insertion order.
 */
export interface AnchorHandRecord {
  handId: string;
  tableId: string;
  handNumber: number;
  serverSeedHash: string;
  serverSeed: string | null;
  deckHash: string;
  potAmount: string;
  rakeAmount: string;
  completedAt: string | null; // ISO 8601
  results: AnchorResultRecord[];
}

/** Build the canonical record from raw hand + result rows. */
export function canonicalHandRecord(hand: {
  id: string;
  tableId: string;
  handNumber: number;
  serverSeedHash: string;
  serverSeed: string | null;
  deckHash: string;
  potAmount: bigint;
  rakeAmount: bigint;
  completedAt: Date | null;
  results: Array<{
    seatNumber: number;
    amountWon: bigint;
    handDescription: string;
    cards: unknown;
  }>;
}): AnchorHandRecord {
  return {
    handId: hand.id,
    tableId: hand.tableId,
    handNumber: hand.handNumber,
    serverSeedHash: hand.serverSeedHash,
    serverSeed: hand.serverSeed,
    deckHash: hand.deckHash,
    potAmount: hand.potAmount.toString(),
    rakeAmount: hand.rakeAmount.toString(),
    completedAt: hand.completedAt ? hand.completedAt.toISOString() : null,
    results: [...hand.results]
      .sort((a, b) => a.seatNumber - b.seatNumber)
      .map((r) => ({
        seat: r.seatNumber,
        amountWon: r.amountWon.toString(),
        handDescription: r.handDescription,
        cards: r.cards,
      })),
  };
}

/** Deterministic JSON encoding of a canonical record (stable key order). */
export function encodeRecord(record: AnchorHandRecord): string {
  return JSON.stringify(record);
}

/** Leaf hash for a canonical record: sha256(0x00 || utf8(json)). */
export function leafHash(record: AnchorHandRecord): Buffer {
  return sha256(LEAF_PREFIX, Buffer.from(encodeRecord(record), "utf8"));
}

/** Internal node hash: sha256(0x01 || left || right). */
function nodeHash(left: Buffer, right: Buffer): Buffer {
  return sha256(NODE_PREFIX, left, right);
}

/**
 * Build the full Merkle tree. Returns layers bottom-up: layers[0] are the leaf
 * hashes (in the given order), the final layer is the single root. Odd nodes are
 * promoted by hashing with themselves.
 */
export function buildMerkleTree(leaves: Buffer[]): Buffer[][] {
  if (leaves.length === 0) throw new Error("cannot anchor an empty batch");
  const layers: Buffer[][] = [leaves];
  while (layers[layers.length - 1]!.length > 1) {
    const prev = layers[layers.length - 1]!;
    const next: Buffer[] = [];
    for (let i = 0; i < prev.length; i += 2) {
      const left = prev[i]!;
      const right = i + 1 < prev.length ? prev[i + 1]! : left;
      next.push(nodeHash(left, right));
    }
    layers.push(next);
  }
  return layers;
}

export function merkleRoot(leaves: Buffer[]): Buffer {
  const layers = buildMerkleTree(leaves);
  return layers[layers.length - 1]![0]!;
}

export interface ProofStep {
  /** Sibling hash (hex). */
  sibling: string;
  /** Whether the sibling sits on the left of the current node. */
  siblingOnLeft: boolean;
}

/** Merkle inclusion proof for the leaf at `index` against the built tree. */
export function merkleProof(layers: Buffer[][], index: number): ProofStep[] {
  const proof: ProofStep[] = [];
  let idx = index;
  for (let level = 0; level < layers.length - 1; level++) {
    const nodes = layers[level]!;
    const isRight = idx % 2 === 1;
    const siblingIdx = isRight ? idx - 1 : idx + 1;
    const sibling = siblingIdx < nodes.length ? nodes[siblingIdx]! : nodes[idx]!;
    proof.push({ sibling: sibling.toString("hex"), siblingOnLeft: isRight });
    idx = Math.floor(idx / 2);
  }
  return proof;
}

/** Recompute a root from a leaf hash + proof; used by verifiers. */
export function rootFromProof(leaf: Buffer, proof: ProofStep[]): string {
  let acc = leaf;
  for (const step of proof) {
    const sib = Buffer.from(step.sibling, "hex");
    acc = step.siblingOnLeft ? nodeHash(sib, acc) : nodeHash(acc, sib);
  }
  return acc.toString("hex");
}

/** The compact string posted on-chain in the anchor memo. */
export function buildAnchorMemo(rootHex: string, handCount: number): string {
  return `${ANCHOR_MEMO_PREFIX}:${rootHex}:${handCount}`;
}
