import { describe, expect, it } from "vitest";
import {
  createDeck,
  deckHash,
  generateServerSeed,
  hashServerSeed,
  shuffleDeckFromSeed,
  verifyShuffleProof,
  ALGORITHM,
} from "../rng";

describe("deck", () => {
  it("has 52 unique cards", () => {
    const deck = createDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck).size).toBe(52);
  });
});

describe("deterministic shuffle", () => {
  const input = {
    serverSeed: "a".repeat(64),
    tableId: "table-1",
    handId: "hand-1",
    clientSeeds: ["bob", "alice"],
  };

  it("is deterministic for identical input", () => {
    const a = shuffleDeckFromSeed(input);
    const b = shuffleDeckFromSeed(input);
    expect(a).toEqual(b);
    expect(deckHash(a)).toBe(deckHash(b));
  });

  it("is order-independent in client seeds (sorted internally)", () => {
    const a = shuffleDeckFromSeed(input);
    const b = shuffleDeckFromSeed({ ...input, clientSeeds: ["alice", "bob"] });
    expect(a).toEqual(b);
  });

  it("changes when the server seed changes", () => {
    const a = shuffleDeckFromSeed(input);
    const b = shuffleDeckFromSeed({ ...input, serverSeed: "b".repeat(64) });
    expect(deckHash(a)).not.toBe(deckHash(b));
  });

  it("produces a valid 52-card permutation", () => {
    const deck = shuffleDeckFromSeed(input);
    expect(new Set(deck).size).toBe(52);
  });
});

describe("commit-reveal verification", () => {
  it("verifies a correct proof", () => {
    const serverSeed = generateServerSeed();
    const serverSeedHash = hashServerSeed(serverSeed);
    const clientSeeds = ["x"];
    const deck = shuffleDeckFromSeed({
      serverSeed,
      tableId: "t",
      handId: "h",
      clientSeeds,
    });
    const result = verifyShuffleProof({
      algorithm: ALGORITHM,
      serverSeedHash,
      serverSeed,
      clientSeeds,
      tableId: "t",
      handId: "h",
      deckHash: deckHash(deck),
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a tampered server seed (commitment broken)", () => {
    const serverSeed = generateServerSeed();
    const serverSeedHash = hashServerSeed(serverSeed);
    const deck = shuffleDeckFromSeed({
      serverSeed,
      tableId: "t",
      handId: "h",
      clientSeeds: [],
    });
    const result = verifyShuffleProof({
      algorithm: ALGORITHM,
      serverSeedHash,
      serverSeed: generateServerSeed(), // different from committed
      clientSeeds: [],
      tableId: "t",
      handId: "h",
      deckHash: deckHash(deck),
    });
    expect(result.ok).toBe(false);
  });

  it("fails when the seed is not yet revealed", () => {
    const result = verifyShuffleProof({
      algorithm: ALGORITHM,
      serverSeedHash: "deadbeef",
      serverSeed: null,
      clientSeeds: [],
      tableId: "t",
      handId: "h",
      deckHash: "x",
    });
    expect(result.ok).toBe(false);
  });
});
