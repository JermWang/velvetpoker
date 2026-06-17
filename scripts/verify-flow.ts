/**
 * End-to-end functional check against the real database.
 *
 * Drives a full Texas Hold'em hand through the authoritative TableRoom with the
 * production persistence + ledger wiring, then asserts:
 *   - buy-ins locked funds (available -> table-locked)
 *   - the hand settled with chip conservation
 *   - Hand / HandAction / HandResult / RngProof rows were written
 *   - the verifiable shuffle proof checks out
 *   - cached balances reconcile to the ledger after cash-out
 *
 * Run: npx tsx -r dotenv/config scripts/verify-flow.ts dotenv_config_path=.env
 * (or: npm run verify:flow)
 */

import { prisma } from "../src/lib/db/prisma";
import { lockBuyIn, cashOutSeat, reconcileUserBalance } from "../src/lib/ledger/ledger";
import { parseSolToLamports, formatLamportsToSol } from "../src/lib/ledger/money";
import { TableRoom } from "../src/lib/realtime/table-room";
import { attachHandPersistence } from "../src/lib/realtime/persistence";
import { verifyShuffleProof, ALGORITHM } from "../src/lib/poker/rng";
import type { ServerEvent } from "../src/lib/realtime/events";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error("ASSERT FAILED: " + msg);
  console.log("  ✓ " + msg);
}

async function main() {
  console.log("Velvet Poker — end-to-end flow verification\n");

  const table = await prisma.pokerTable.findFirstOrThrow({
    where: { name: "The Velvet Room" },
  });
  const alice = await prisma.user.findUniqueOrThrow({
    where: { privyUserId: "dev:alice@example.com" },
  });
  const bob = await prisma.user.findUniqueOrThrow({
    where: { privyUserId: "dev:bob@example.com" },
  });

  // Clean slate for a repeatable run: a fresh room restarts hand numbering at 1,
  // so clear this table's prior hands (cascades actions/results/proofs) and
  // return any locked funds to available.
  await prisma.hand.deleteMany({ where: { tableId: table.id } });
  for (const u of [alice, bob]) {
    const bal = await prisma.balance.findUnique({ where: { userId_asset: { userId: u.id, asset: "SOL" } } });
    if (bal && bal.lockedAmount > 0n) {
      await cashOutSeat({ userId: u.id, asset: "SOL", amount: bal.lockedAmount, tableId: table.id, correlationId: `verify-reset:${u.id}:${Date.now()}` });
    }
  }

  // Snapshot starting available balances.
  const startAlice = await reconcileUserBalance(alice.id, "SOL");
  const startBob = await reconcileUserBalance(bob.id, "SOL");
  console.log(
    `Start: alice ${formatLamportsToSol(startAlice.ledgerAvailable)} SOL, bob ${formatLamportsToSol(startBob.ledgerAvailable)} SOL\n`,
  );

  const buyIn = parseSolToLamports("1"); // 1 SOL each

  // 1) Lock buy-ins (available -> table-locked) exactly as the WS server does.
  await lockBuyIn({ userId: alice.id, asset: "SOL", amount: buyIn, tableId: table.id, correlationId: `verify-buyin:${alice.id}:${Date.now()}` });
  await lockBuyIn({ userId: bob.id, asset: "SOL", amount: buyIn, tableId: table.id, correlationId: `verify-buyin:${bob.id}:${Date.now()}` });
  const lockedAlice = await reconcileUserBalance(alice.id, "SOL");
  assert(lockedAlice.ok && lockedAlice.cachedLocked >= buyIn, "buy-in locked alice's funds and reconciles");

  // 2) Build the room with production persistence wired to the real DB.
  let completedHandNumber = 0;
  const handCompleted = new Promise<void>((resolve) => {
    const room = new TableRoom(
      {
        tableId: table.id,
        name: table.name,
        asset: table.asset,
        smallBlind: table.smallBlind,
        bigBlind: table.bigBlind,
        maxSeats: table.maxSeats,
        actionTimeoutSeconds: 30,
      },
      {
        send: (playerId, event) => onEvent(room, playerId, event),
        broadcast: () => {},
      },
    );

    let done = false;
    attachHandPersistence(
      room,
      { id: table.id, asset: table.asset },
      {
        afterHandCompleted: (info) => {
          if (done) return;
          done = true;
          completedHandNumber = info.handNumber;
          // Stop the room from dealing another hand: sit both players out so the
          // next auto-deal finds < 2 eligible players.
          room.setSitOut(alice.id, true);
          room.setSitOut(bob.id, true);
          // let the ledger settlement (onHandSettled) flush first
          setTimeout(resolve, 800);
        },
      },
    );

    // Auto-pilot: respond to each ACTION_REQUIRED by checking or calling, so the
    // hand runs to showdown deterministically.
    function onEvent(r: TableRoom, playerId: string, event: ServerEvent) {
      if (event.t === "ACTION_REQUIRED") {
        const toCall = BigInt(event.toCall);
        setImmediate(() =>
          r.handleAction(playerId, toCall > 0n ? "CALL" : "CHECK"),
        );
      }
    }

    // Seat both players; the room auto-deals when 2+ are seated.
    room.sit({ playerId: alice.id, displayName: "alice", seatNumber: 0, stack: buyIn });
    room.sit({ playerId: bob.id, displayName: "bob", seatNumber: 1, stack: buyIn });
  });

  await handCompleted;
  console.log("\nHand completed. Verifying persistence…");

  // 3) Hand rows persisted (query the exact hand we just played).
  const hand = await prisma.hand.findFirstOrThrow({
    where: { tableId: table.id, handNumber: completedHandNumber },
    include: { actions: true, results: true, rngProof: true },
  });
  assert(hand.status === "COMPLETE", "Hand row marked COMPLETE");
  assert(!!hand.serverSeed, "server seed revealed on the Hand row");
  assert(hand.actions.length > 0, `HandAction rows written (${hand.actions.length})`);
  assert(hand.results.length > 0, `HandResult rows written (${hand.results.length})`);
  assert(!!hand.rngProof, "RngProof row written");

  // 4) Verifiable shuffle proof checks out (same derivation the API uses).
  const clientSeeds = (hand.rngProof!.clientSeeds as string[]) ?? [];
  const proof = verifyShuffleProof({
    algorithm: hand.rngProof!.algorithm ?? ALGORITHM,
    serverSeedHash: hand.serverSeedHash,
    serverSeed: hand.serverSeed,
    clientSeeds,
    tableId: hand.tableId,
    handId: `${hand.tableId}:${hand.handNumber}`,
    deckHash: hand.deckHash,
  });
  assert(proof.ok, "verifiable shuffle proof recomputes correctly");

  // 5) Settlement: locked balances must equal each player's final stack, and a
  // net transfer (non-chop) must produce POT_AWARDED ledger entries.
  const potEntries = await prisma.ledgerEntry.count({
    where: { handId: hand.id, reason: "POT_AWARDED" },
  });
  const lockedAfter: Record<string, bigint> = {};
  for (const u of [alice, bob]) {
    const b = await prisma.balance.findUniqueOrThrow({ where: { userId_asset: { userId: u.id, asset: "SOL" } } });
    lockedAfter[u.id] = b.lockedAmount;
  }
  const totalLocked = lockedAfter[alice.id]! + lockedAfter[bob.id]!;
  assert(totalLocked === buyIn * 2n, "table-locked funds conserved across the hand (= total buy-ins)");
  const chop = lockedAfter[alice.id] === buyIn && lockedAfter[bob.id] === buyIn;
  if (chop) {
    console.log("  ✓ hand chopped — no net transfer, so no POT_AWARDED entries (correct)");
  } else {
    assert(potEntries > 0, `net transfer produced POT_AWARDED ledger entries (${potEntries})`);
  }

  // 6) Cash both players out (table-locked -> available) and reconcile.
  for (const u of [alice, bob]) {
    const bal = await prisma.balance.findUniqueOrThrow({ where: { userId_asset: { userId: u.id, asset: "SOL" } } });
    if (bal.lockedAmount > 0n) {
      await cashOutSeat({ userId: u.id, asset: "SOL", amount: bal.lockedAmount, tableId: table.id, correlationId: `verify-cashout:${u.id}:${Date.now()}` });
    }
  }
  const endAlice = await reconcileUserBalance(alice.id, "SOL");
  const endBob = await reconcileUserBalance(bob.id, "SOL");
  assert(endAlice.ok, "alice's cached balance reconciles to the ledger");
  assert(endBob.ok, "bob's cached balance reconciles to the ledger");
  assert(endAlice.cachedLocked === 0n && endBob.cachedLocked === 0n, "no funds left locked after cash-out");

  const startTotal = startAlice.ledgerAvailable + startBob.ledgerAvailable;
  const endTotal = endAlice.ledgerAvailable + endBob.ledgerAvailable;
  assert(startTotal === endTotal, `SOL conserved across the hand (${formatLamportsToSol(startTotal)} -> ${formatLamportsToSol(endTotal)})`);

  const winner = hand.results.find((r) => r.amountWon > 0n);
  console.log(`\nResult: ${winner ? `${winner.handDescription} won ${formatLamportsToSol(winner.amountWon)} SOL` : "split"}`);
  console.log("End: alice", formatLamportsToSol(endAlice.ledgerAvailable), "SOL, bob", formatLamportsToSol(endBob.ledgerAvailable), "SOL");
  console.log("\n✅ ALL CHECKS PASSED — end-to-end flow works against the live database.");
}

main()
  .catch((e) => {
    console.error("\n❌ VERIFICATION FAILED:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
