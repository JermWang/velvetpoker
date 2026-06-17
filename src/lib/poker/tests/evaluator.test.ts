import { describe, expect, it } from "vitest";
import { compareHands, evaluateHand } from "../evaluator";
import type { Card } from "../types";

const C = (s: string) => s.split(" ") as Card[];

describe("hand ranking categories", () => {
  it("detects a royal/straight flush", () => {
    const h = evaluateHand(C("Ah Kh Qh Jh Th 2c 3d"));
    expect(h.category).toBe("STRAIGHT_FLUSH");
  });

  it("detects four of a kind", () => {
    const h = evaluateHand(C("9c 9d 9h 9s Kd 2c 3d"));
    expect(h.category).toBe("FOUR_OF_A_KIND");
  });

  it("detects a full house", () => {
    const h = evaluateHand(C("Qc Qd Qh 7s 7d 2c 3d"));
    expect(h.category).toBe("FULL_HOUSE");
  });

  it("detects a flush", () => {
    const h = evaluateHand(C("Ah 9h 5h 3h 2h Kc Qd"));
    expect(h.category).toBe("FLUSH");
  });

  it("detects the wheel straight (A-2-3-4-5)", () => {
    const h = evaluateHand(C("Ah 2c 3d 4s 5h Kd Qc"));
    expect(h.category).toBe("STRAIGHT");
    // wheel is 5-high, not ace-high
    expect(h.tiebreakers[0]).toBe(5);
  });

  it("detects two pair and a single pair", () => {
    expect(evaluateHand(C("Ah Ad Kc Ks 2h 3c 4d")).category).toBe("TWO_PAIR");
    expect(evaluateHand(C("Ah Ad Kc Qs 2h 3c 4d")).category).toBe("PAIR");
  });

  it("falls back to high card", () => {
    expect(evaluateHand(C("Ah Kd Qc Js 9h 3c 2d")).category).toBe("HIGH_CARD");
  });
});

describe("hand comparison", () => {
  it("higher full house beats lower full house", () => {
    const a = evaluateHand(C("Ac Ad Ah Ks Kd 2c 3d")); // aces full
    const b = evaluateHand(C("Kc Kd Kh As Ad 2c 3d")); // kings full
    expect(compareHands(a, b)).toBeGreaterThan(0);
  });

  it("kicker decides between equal pairs", () => {
    const a = evaluateHand(C("Ah Ad Kc Qh 9s 3c 2d"));
    const b = evaluateHand(C("As Ac Kd Jh 9s 3c 2d"));
    expect(compareHands(a, b)).toBeGreaterThan(0); // Q kicker > J kicker
  });

  it("identical hands tie", () => {
    const a = evaluateHand(C("Ah Kh Qh Jh Th 2c 3d"));
    const b = evaluateHand(C("As Ks Qs Js Ts 2c 3d"));
    expect(compareHands(a, b)).toBe(0);
  });

  it("flush beats a straight", () => {
    const flush = evaluateHand(C("2h 4h 6h 8h Th Kc Qd"));
    const straight = evaluateHand(C("9c Ts Jh Qd Kh 2s 3d"));
    expect(compareHands(flush, straight)).toBeGreaterThan(0);
  });
});
