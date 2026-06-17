import { describe, expect, it } from "vitest";
import { calculateSidePots } from "../side-pots";
import type { SeatState } from "../types";

function seat(
  seatNo: number,
  committedTotal: bigint,
  opts: Partial<SeatState> = {},
): SeatState {
  return {
    seat: seatNo,
    playerId: `p${seatNo}`,
    stack: 0n,
    holeCards: [],
    committedThisStreet: 0n,
    committedTotal,
    hasFolded: false,
    isAllIn: false,
    inHand: true,
    hasActedThisStreet: true,
    ...opts,
  };
}

describe("side pots", () => {
  it("single pot when all commit equally", () => {
    const pots = calculateSidePots([
      seat(0, 100n),
      seat(1, 100n),
      seat(2, 100n),
    ]);
    expect(pots).toHaveLength(1);
    expect(pots[0]!.amount).toBe(300n);
    expect(pots[0]!.eligibleSeats).toEqual([0, 1, 2]);
  });

  it("builds a main + side pot for an all-in short stack", () => {
    // seat 0 all-in for 50, seats 1&2 commit 200
    const pots = calculateSidePots([
      seat(0, 50n, { isAllIn: true }),
      seat(1, 200n),
      seat(2, 200n),
    ]);
    // main pot: 50*3 = 150 (all eligible); side pot: 150*2 = 300 (seats 1,2)
    expect(pots).toHaveLength(2);
    expect(pots[0]!.amount).toBe(150n);
    expect(pots[0]!.eligibleSeats).toEqual([0, 1, 2]);
    expect(pots[1]!.amount).toBe(300n);
    expect(pots[1]!.eligibleSeats).toEqual([1, 2]);
  });

  it("excludes folded players from eligibility but keeps their chips", () => {
    const pots = calculateSidePots([
      seat(0, 100n, { hasFolded: true }),
      seat(1, 100n),
      seat(2, 100n),
    ]);
    expect(pots).toHaveLength(1);
    expect(pots[0]!.amount).toBe(300n);
    expect(pots[0]!.eligibleSeats).toEqual([1, 2]);
  });

  it("handles three different all-in depths", () => {
    const pots = calculateSidePots([
      seat(0, 50n, { isAllIn: true }),
      seat(1, 120n, { isAllIn: true }),
      seat(2, 300n),
    ]);
    // level 50: 50*3=150 -> [0,1,2]
    // level 120: 70*2=140 -> [1,2]
    // level 300: 180*1=180 -> [2]
    expect(pots.map((p) => p.amount)).toEqual([150n, 140n, 180n]);
    expect(pots.map((p) => p.eligibleSeats)).toEqual([[0, 1, 2], [1, 2], [2]]);
  });
});
