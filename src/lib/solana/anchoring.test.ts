import { describe, it, expect } from "vitest";
import {
  canonicalHandRecord,
  leafHash,
  buildMerkleTree,
  merkleProof,
  merkleRoot,
  rootFromProof,
  encodeRecord,
} from "./anchoring";

function makeHand(i: number) {
  return {
    id: `hand_${String(i).padStart(4, "0")}`,
    tableId: "tbl_1",
    handNumber: i,
    serverSeedHash: `hash_${i}`,
    serverSeed: `seed_${i}`,
    deckHash: `deck_${i}`,
    potAmount: BigInt(1000 * i),
    rakeAmount: BigInt(10 * i),
    completedAt: new Date(1_700_000_000_000 + i * 1000),
    results: [
      { seatNumber: 2, amountWon: BigInt(990 * i), handDescription: "Flush", cards: ["As", "Ks"] },
      { seatNumber: 0, amountWon: BigInt(0), handDescription: "Pair", cards: ["2c", "7d"] },
    ],
  };
}

describe("outcome anchoring Merkle proofs", () => {
  it("results are sorted by seat so encoding is order-independent", () => {
    const rec = canonicalHandRecord(makeHand(1));
    expect(rec.results.map((r) => r.seat)).toEqual([0, 2]);
    // bigints are stringified
    expect(rec.potAmount).toBe("1000");
  });

  it("encoding is deterministic", () => {
    expect(encodeRecord(canonicalHandRecord(makeHand(3)))).toBe(
      encodeRecord(canonicalHandRecord(makeHand(3))),
    );
  });

  for (const n of [1, 2, 3, 5, 8, 13, 100]) {
    it(`every leaf in a batch of ${n} produces a proof that folds to the root`, () => {
      const records = Array.from({ length: n }, (_, i) => canonicalHandRecord(makeHand(i + 1)));
      const leaves = records.map((r) => leafHash(r));
      const root = merkleRoot(leaves).toString("hex");
      const layers = buildMerkleTree(leaves);
      for (let i = 0; i < n; i++) {
        const proof = merkleProof(layers, i);
        expect(rootFromProof(leaves[i]!, proof)).toBe(root);
      }
    });
  }

  it("a tampered record no longer folds to the anchored root", () => {
    const records = Array.from({ length: 6 }, (_, i) => canonicalHandRecord(makeHand(i + 1)));
    const leaves = records.map((r) => leafHash(r));
    const root = merkleRoot(leaves).toString("hex");
    const layers = buildMerkleTree(leaves);
    const proof = merkleProof(layers, 2);

    // Tamper: change a payout amount after the fact.
    const tampered = { ...records[2]!, results: records[2]!.results.map((r) => ({ ...r, amountWon: "999999" })) };
    const tamperedLeaf = leafHash(tampered);
    expect(rootFromProof(tamperedLeaf, proof)).not.toBe(root);
  });
});
