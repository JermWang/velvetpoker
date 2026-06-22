import { describe, it, expect } from "vitest";
import {
  computeRake,
  splitRakeThreeWays,
  splitRakePrivate,
  RAKE_CAP_BIG_BLINDS,
} from "./rake";

const bb = 2_000_000n; // 0.002 SOL big blind

describe("computeRake", () => {
  it("takes nothing when no flop is seen (no flop, no drop)", () => {
    expect(computeRake({ pot: 1_000_000_000n, rakeBps: 300, bigBlind: bb, flopSeen: false })).toBe(0n);
  });

  it("takes nothing when rake is disabled", () => {
    expect(computeRake({ pot: 1_000_000_000n, rakeBps: 0, bigBlind: bb, flopSeen: true })).toBe(0n);
  });

  it("takes 3% of the pot below the cap", () => {
    // pot 0.1 SOL = 100_000_000; 3% = 3_000_000; cap = 3 * bb = 6_000_000 (not hit)
    expect(computeRake({ pot: 100_000_000n, rakeBps: 300, bigBlind: bb, flopSeen: true })).toBe(3_000_000n);
  });

  it("caps the rake at RAKE_CAP_BIG_BLINDS big blinds", () => {
    // huge pot: 3% would be enormous, but cap = 3 * bb = 6_000_000
    const r = computeRake({ pot: 10_000_000_000n, rakeBps: 300, bigBlind: bb, flopSeen: true });
    expect(r).toBe(bb * RAKE_CAP_BIG_BLINDS);
    expect(r).toBe(6_000_000n);
  });
});

describe("splitRakeThreeWays", () => {
  it("splits evenly and conserves the total", () => {
    const s = splitRakeThreeWays(3_000_000n);
    expect(s).toEqual({ team: 1_000_000n, buyback: 1_000_000n, referral: 1_000_000n });
    expect(s.team + s.buyback + s.referral).toBe(3_000_000n);
  });

  it("gives the rounding remainder to the house and still conserves the total", () => {
    for (const rake of [1n, 2n, 4n, 5n, 7n, 100n, 99_999_999n]) {
      const s = splitRakeThreeWays(rake);
      expect(s.team + s.buyback + s.referral).toBe(rake);
      // referral/buyback never exceed an even third; team holds the remainder
      expect(s.buyback).toBe(rake / 3n);
      expect(s.referral).toBe(rake / 3n);
      expect(s.team).toBeGreaterThanOrEqual(s.buyback);
    }
  });
});

describe("splitRakePrivate", () => {
  it("splits the 2% private rake evenly: half house, half buyback", () => {
    const s = splitRakePrivate(2_000_000n);
    expect(s).toEqual({ team: 1_000_000n, buyback: 1_000_000n });
    expect(s.team + s.buyback).toBe(2_000_000n);
  });

  it("gives the odd remainder to the house and conserves the total", () => {
    for (const rake of [1n, 3n, 5n, 7n, 101n, 99_999_999n]) {
      const s = splitRakePrivate(rake);
      expect(s.team + s.buyback).toBe(rake);
      expect(s.buyback).toBe(rake / 2n);
      expect(s.team).toBeGreaterThanOrEqual(s.buyback);
    }
  });
});
