import { describe, expect, it } from "vitest";
import { TableRoom, type RoomConfig } from "./table-room";

function makeRoom(): TableRoom {
  const config: RoomConfig = {
    tableId: "t1",
    name: "Test",
    asset: "USDC",
    smallBlind: 1n,
    bigBlind: 2n,
    maxSeats: 6,
    actionTimeoutSeconds: 30,
    rakeBps: 0,
    isDemo: false,
  };
  // No-op IO — we only assert in-memory seat state.
  return new TableRoom(config, { send: () => {}, broadcast: () => {} });
}

describe("crash recovery: restoreSeats", () => {
  it("rebuilds seats from ledger-derived stacks (disconnected, sequential)", () => {
    const room = makeRoom();
    room.restoreSeats([
      { playerId: "alice", displayName: "Alice", stack: 500n },
      { playerId: "bob", displayName: "Bob", stack: 1200n },
    ]);
    expect(room.hasPlayer("alice")).toBe(true);
    expect(room.hasPlayer("bob")).toBe(true);
    expect(room.stackOf("alice")).toBe(500n);
    expect(room.stackOf("bob")).toBe(1200n);
    expect(room.occupiedSeatCount()).toBe(2);
  });

  it("skips players with a zero/negative stack (already cashed out)", () => {
    const room = makeRoom();
    room.restoreSeats([
      { playerId: "alice", displayName: "Alice", stack: 0n },
      { playerId: "bob", displayName: "Bob", stack: 300n },
    ]);
    expect(room.hasPlayer("alice")).toBe(false);
    expect(room.hasPlayer("bob")).toBe(true);
    expect(room.occupiedSeatCount()).toBe(1);
  });

  it("does not deal restored (disconnected) players into a new hand alone", () => {
    const room = makeRoom();
    room.restoreSeats([
      { playerId: "alice", displayName: "Alice", stack: 500n },
      { playerId: "bob", displayName: "Bob", stack: 500n },
    ]);
    // Both restored players are disconnected, so no hand should auto-start.
    const state = room.buildTableState();
    expect(state.handId == null || state.street == null).toBe(true);
  });

  it("is a no-op once the room already has seats", () => {
    const room = makeRoom();
    room.sit({ playerId: "carol", displayName: "Carol", seatNumber: 2, stack: 100n });
    room.restoreSeats([{ playerId: "dave", displayName: "Dave", stack: 999n }]);
    expect(room.hasPlayer("dave")).toBe(false);
    expect(room.hasPlayer("carol")).toBe(true);
    expect(room.occupiedSeatCount()).toBe(1);
  });
});

describe("busted-seat eviction (queue-aware rebuy)", () => {
  it("reclaims a busted (zero-stack, sitting-out) seat to make room", () => {
    const room = makeRoom();
    // A busted player keeps their seat (zero stack, sitting out) — no auto-free.
    room.sit({ playerId: "bob", displayName: "Bob", seatNumber: 1, stack: 0n });
    room.setSitOut("bob", true);
    expect(room.hasPlayer("bob")).toBe(true);
    const freed = room.evictOneBustedSeat();
    expect(freed).toBe(1);
    expect(room.hasPlayer("bob")).toBe(false);
  });

  it("does not evict a seat that still has chips", () => {
    const room = makeRoom();
    room.sit({ playerId: "alice", displayName: "Alice", seatNumber: 0, stack: 100n });
    expect(room.evictOneBustedSeat()).toBe(null);
    expect(room.hasPlayer("alice")).toBe(true);
  });
});
