import { describe, expect, it } from "vitest";
import {
  applyAction,
  createHand,
  ActionError,
  type SeatInput,
} from "../hand";
import { createDeck } from "../rng";
import type { Card, HandState } from "../types";

/**
 * Build a 52-card deck whose first cards are exactly `first`, with the rest of
 * the deck filled deterministically from the remaining cards. This lets us pin
 * down hole/community cards in tests.
 */
function makeDeck(first: Card[]): Card[] {
  const used = new Set(first);
  const rest = createDeck().filter((c) => !used.has(c));
  return [...first, ...rest];
}

function totalChips(state: HandState): bigint {
  // During a hand, live chips = behind (stack) + in the pot (committedTotal).
  // Once the hand is complete the pot has been distributed back into stacks,
  // and committedTotal is kept only as a historical record of what was wagered.
  return state.isComplete
    ? state.seats.reduce((sum, s) => sum + s.stack, 0n)
    : state.seats.reduce((sum, s) => sum + s.stack + s.committedTotal, 0n);
}

const players: SeatInput[] = [
  { seat: 0, playerId: "alice", stack: 100n },
  { seat: 1, playerId: "bob", stack: 100n },
];

const config = {
  handId: "h1",
  tableId: "t1",
  smallBlind: 1n,
  bigBlind: 2n,
  dealerSeat: 0,
};

describe("hand setup (heads-up)", () => {
  it("posts blinds and sets first actor to the SB/dealer", () => {
    const s = createHand(config, players, createDeck());
    // heads-up: dealer is SB
    expect(s.smallBlindSeat).toBe(0);
    expect(s.bigBlindSeat).toBe(1);
    expect(s.seats[0]!.committedThisStreet).toBe(1n);
    expect(s.seats[1]!.committedThisStreet).toBe(2n);
    expect(s.currentBet).toBe(2n);
    expect(s.toActSeat).toBe(0); // SB acts first preflop heads-up
    expect(s.seats[0]!.holeCards).toHaveLength(2);
    expect(s.seats[1]!.holeCards).toHaveLength(2);
  });
});

describe("action validation", () => {
  it("rejects acting out of turn", () => {
    const s = createHand(config, players, createDeck());
    expect(() => applyAction(s, { seat: 1, type: "CHECK" })).toThrow(
      ActionError,
    );
  });

  it("rejects checking when facing a bet", () => {
    const s = createHand(config, players, createDeck());
    // SB owes 1 to call; cannot check
    expect(() => applyAction(s, { seat: 0, type: "CHECK" })).toThrow(
      ActionError,
    );
  });

  it("rejects a raise below the minimum", () => {
    const s = createHand(config, players, createDeck());
    // currentBet 2, lastRaiseSize 2 -> min raise to 4. Raising to 3 is illegal.
    expect(() => applyAction(s, { seat: 0, type: "RAISE", amount: 3n })).toThrow(
      ActionError,
    );
  });

  it("rejects betting more than the stack", () => {
    const s = createHand(config, players, createDeck());
    expect(() =>
      applyAction(s, { seat: 0, type: "RAISE", amount: 1000n }),
    ).toThrow(ActionError);
  });
});

describe("uncontested pot (fold)", () => {
  it("awards the pot to the last player standing and conserves chips", () => {
    const s = createHand(config, players, createDeck());
    applyAction(s, { seat: 0, type: "RAISE", amount: 6n }); // alice raises
    applyAction(s, { seat: 1, type: "FOLD" }); // bob folds
    expect(s.isComplete).toBe(true);
    const alice = s.seats[0]!;
    // alice committed 6, wins pot (6 + bob's 2) = 8 -> stack 100-6+8 = 102
    expect(alice.stack).toBe(102n);
    expect(totalChips(s)).toBe(200n);
  });
});

describe("full hand to showdown", () => {
  it("awards the pot to the best hand", () => {
    // Hole deal order (heads-up, dealer seat 0):
    //   bob c0, alice c1, bob c2, alice c3
    // => alice = deck[1],deck[3]; bob = deck[0],deck[2]
    // community = deck[5,6,7] (flop), deck[9] (turn), deck[11] (river)
    const deck = makeDeck([
      "2c", // 0 bob
      "Ah", // 1 alice
      "2d", // 2 bob
      "Ad", // 3 alice
      "5s", // 4 burn
      "As", // 5 flop
      "Kh", // 6 flop
      "Qd", // 7 flop
      "7s", // 8 burn
      "Jc", // 9 turn
      "3h", // 10 burn
      "9c", // 11 river
    ]);
    const s = createHand(config, players, deck);
    // preflop: alice (SB) calls, bob (BB) checks option
    applyAction(s, { seat: 0, type: "CALL" });
    applyAction(s, { seat: 1, type: "CHECK" });
    // flop, turn, river: check it down. Postflop bob (seat 1) acts first.
    for (let street = 0; street < 3; street++) {
      applyAction(s, { seat: 1, type: "CHECK" });
      applyAction(s, { seat: 0, type: "CHECK" });
    }
    expect(s.isComplete).toBe(true);
    // alice has trip aces (Ah Ad + As), bob a pair of deuces -> alice wins
    const alice = s.results.find((r) => r.playerId === "alice")!;
    expect(alice.amountWon).toBe(4n);
    expect(alice.handDescription).toBe("Three of a Kind");
    expect(totalChips(s)).toBe(200n);
  });
});

describe("split pot", () => {
  it("splits evenly when the board plays for both", () => {
    // Give both players hands that cannot beat the board (board = royal-ish):
    // community plays as the best 5 for both -> chop.
    // alice = deck[1],deck[3]; bob = deck[0],deck[2]
    const deck = makeDeck([
      "2c", // 0 bob
      "2h", // 1 alice
      "3c", // 2 bob
      "3d", // 3 alice
      "9s", // 4 burn
      "Ah", // 5 flop
      "Kh", // 6 flop
      "Qh", // 7 flop
      "9d", // 8 burn
      "Jh", // 9 turn
      "9h", // 10 burn  (note: irrelevant burn)
      "Th", // 11 river
    ]);
    // board = Ah Kh Qh Jh Th = royal flush in hearts; both players play the board
    const s = createHand(config, players, deck);
    applyAction(s, { seat: 0, type: "CALL" });
    applyAction(s, { seat: 1, type: "CHECK" });
    for (let street = 0; street < 3; street++) {
      applyAction(s, { seat: 1, type: "CHECK" });
      applyAction(s, { seat: 0, type: "CHECK" });
    }
    expect(s.isComplete).toBe(true);
    const alice = s.seats[0]!;
    const bob = s.seats[1]!;
    // pot of 4 split 2/2; both back to 100
    expect(alice.stack).toBe(100n);
    expect(bob.stack).toBe(100n);
    expect(totalChips(s)).toBe(200n);
  });
});

describe("uncalled bet refund (over-shove vs short all-in)", () => {
  it("refunds the uncalled portion, runs out the board, and conserves chips", () => {
    // Heads-up, dealer/SB = seat 0 (alice), BB = seat 1 (bob, short).
    // alice = deck[1],deck[3]; bob = deck[0],deck[2]; board = deck[5,6,7,9,11].
    const hu: SeatInput[] = [
      { seat: 0, playerId: "alice", stack: 200n },
      { seat: 1, playerId: "bob", stack: 20n },
    ];
    // All-in run-out burns one card per board card, so the board is
    // deck[5,7,9,11,13] (burns are deck[4,6,8,10,12]). Pin all 14.
    const deck = makeDeck([
      "2c", // 0 bob hole
      "Ah", // 1 alice hole
      "2d", // 2 bob hole
      "Ad", // 3 alice hole
      "5s", // 4 burn
      "Kh", // 5 board
      "Qd", // 6 burn
      "7s", // 7 board
      "8h", // 8 burn
      "Jc", // 9 board
      "3h", // 10 burn
      "9d", // 11 board
      "4c", // 12 burn
      "6d", // 13 board
    ]);
    const s = createHand(config, hu, deck); // SB 1 / BB 2 / dealer 0
    // alice (SB) raises to 50; bob can only call 20 all-in (a call for less),
    // so alice's extra 30 is uncalled and must be returned. With only alice able
    // to act, the engine should run the board out instead of prompting her.
    applyAction(s, { seat: 0, type: "RAISE", amount: 50n });
    applyAction(s, { seat: 1, type: "ALL_IN" });

    expect(s.isComplete).toBe(true);
    // pot = bob's 20 + alice's matched 20 = 40; alice wins with a pair of aces.
    const alice = s.seats[0]!;
    const bob = s.seats[1]!;
    expect(bob.stack).toBe(0n); // bob busts
    expect(alice.stack).toBe(220n); // 200 - 20 wagered + 40 pot (30 refunded)
    expect(totalChips(s)).toBe(220n); // no chips created or destroyed
    const aliceResult = s.results.find((r) => r.playerId === "alice")!;
    expect(aliceResult.amountWon).toBe(40n);
    // sum of winnings must equal the actual (post-refund) pot — never less.
    const totalWon = s.results.reduce((sum, r) => sum + r.amountWon, 0n);
    expect(totalWon).toBe(40n);
  });
});

describe("folded hole cards are never revealed (anti-cheat)", () => {
  it("does not expose a folded contributor's cards at a multi-way showdown", () => {
    // 3-handed: dealer 0 -> SB seat1, BB seat2, UTG/first = seat0.
    // Deal order from left of dealer: seat1, seat2, seat0 (x2).
    // => seat1=deck0,deck3 ; seat2=deck1,deck4 ; seat0=deck2,deck5.
    const three: SeatInput[] = [
      { seat: 0, playerId: "alice", stack: 200n }, // contributes, then folds
      { seat: 1, playerId: "bob", stack: 200n },
      { seat: 2, playerId: "carol", stack: 200n },
    ];
    const deck = makeDeck([
      "7h", // 0 bob hole
      "Ah", // 1 carol hole
      "2c", // 2 alice hole (folds the flop)
      "7d", // 3 bob hole
      "Ad", // 4 carol hole
      "2h", // 5 alice hole
      "9s", // 6 burn
      "Kc", // 7 flop
      "Qd", // 8 flop
      "Js", // 9 flop
      "4s", // 10 burn
      "5d", // 11 turn
      "6c", // 12 burn
      "8d", // 13 river
    ]);
    const s = createHand(config, three, deck); // SB 1 / BB 2
    // Preflop: alice (UTG) calls 2, bob (SB) calls, carol (BB) checks.
    applyAction(s, { seat: 0, type: "CALL" });
    applyAction(s, { seat: 1, type: "CALL" });
    applyAction(s, { seat: 2, type: "CHECK" });
    // Flop: bob checks, carol bets, alice folds (after committing 2 preflop),
    // bob calls — bob & carol go to showdown.
    applyAction(s, { seat: 1, type: "CHECK" });
    applyAction(s, { seat: 2, type: "BET", amount: 10n });
    applyAction(s, { seat: 0, type: "FOLD" });
    applyAction(s, { seat: 1, type: "CALL" });
    // Turn + river checked down.
    while (!s.isComplete) {
      const toAct = s.toActSeat!;
      applyAction(s, { seat: toAct, type: "CHECK" });
    }
    expect(s.isComplete).toBe(true);

    // alice folded but DID contribute, so she has a result row — it must carry
    // NO hole cards and be flagged folded (this is the cheat-prevention check).
    const aliceResult = s.results.find((r) => r.playerId === "alice")!;
    expect(aliceResult).toBeDefined();
    expect(aliceResult.hasFolded).toBe(true);
    expect(aliceResult.cards).toEqual([]);

    // Non-folded showdown players DO reveal exactly their two cards.
    const bobResult = s.results.find((r) => r.playerId === "bob")!;
    const carolResult = s.results.find((r) => r.playerId === "carol")!;
    expect(bobResult.hasFolded).toBe(false);
    expect(bobResult.cards.length).toBe(2);
    expect(carolResult.cards.length).toBe(2);
    // Chip conservation through a folded-contributor showdown.
    expect(totalChips(s)).toBe(600n);
  });
});

describe("all-in and side pots (3-handed)", () => {
  it("settles a short all-in against two larger stacks", () => {
    const three: SeatInput[] = [
      { seat: 0, playerId: "alice", stack: 50n },
      { seat: 1, playerId: "bob", stack: 200n },
      { seat: 2, playerId: "carol", stack: 200n },
    ];
    // 3-handed: dealer 0 -> SB seat1, BB seat2, UTG/first = seat0
    // Deal order starts left of dealer (seat1): seat1,seat2,seat0 x2
    // => seat1=deck0,deck3 ; seat2=deck1,deck4 ; seat0=deck2,deck5
    // We just check chip conservation + a deterministic winner exists.
    const deck = makeDeck([
      "Ah", // 0 bob
      "Kh", // 1 carol
      "Qs", // 2 alice
      "Ad", // 3 bob
      "Kd", // 4 carol
      "Qd", // 5 alice
      "2c", // 6 burn
      "Qc", // 7 flop
      "7h", // 8 flop
      "8h", // 9 flop
      "3c", // 10 burn
      "2d", // 11 turn
      "4c", // 12 burn
      "5d", // 13 river
    ]);
    const s = createHand(
      { ...config, smallBlind: 5n, bigBlind: 10n },
      three,
      deck,
    );
    // alice (UTG) shoves all-in 50
    applyAction(s, { seat: 0, type: "ALL_IN" });
    // bob calls
    applyAction(s, { seat: 1, type: "CALL" });
    // carol calls
    applyAction(s, { seat: 2, type: "CALL" });
    // bob & carol still have chips; they check it down post-flop
    while (!s.isComplete) {
      const toAct = s.toActSeat!;
      applyAction(s, { seat: toAct, type: "CHECK" });
    }
    expect(s.isComplete).toBe(true);
    // chip conservation across all stacks + committed
    expect(totalChips(s)).toBe(450n);
    // alice has trip queens (Qs Qd + Qc), should win the main pot
    const aliceWon = s.results.find((r) => r.playerId === "alice")!.amountWon;
    expect(aliceWon).toBeGreaterThan(0n);
  });
});
