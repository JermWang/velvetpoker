/**
 * End-to-end check of rake-taking, the three-way split, referral accrual, and
 * claiming — against the live database. Plays one raked hand where one player is
 * referred by the other, then asserts the money math and conservation.
 *
 * Run: npm run verify:rake
 */

import { prisma } from "../src/lib/db/prisma";
import {
  lockBuyIn,
  cashOutSeat,
  reconcileUserBalance,
  claimReferralEarnings,
} from "../src/lib/ledger/ledger";
import { parseSolToLamports } from "../src/lib/ledger/money";
import { TableRoom } from "../src/lib/realtime/table-room";
import { attachHandPersistence } from "../src/lib/realtime/persistence";
import { computeRake, splitRakeThreeWays } from "../src/lib/poker/rake";
import type { ServerEvent } from "../src/lib/realtime/events";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error("ASSERT FAILED: " + msg);
  console.log("  ✓ " + msg);
}

const SB = 1_000_000n;
const BB = 2_000_000n;
const RAKE_BPS = 300;

async function sumLeg(handId: string, accountType: string): Promise<bigint> {
  const rows = await prisma.ledgerEntry.findMany({
    where: { handId, accountType: accountType as never, direction: "CREDIT" },
  });
  return rows.reduce((a, r) => a + r.amount, 0n);
}

async function main() {
  console.log("Velvet Poker — rake + referral verification\n");

  const table = await prisma.pokerTable.findFirstOrThrow({ where: { name: "The Velvet Room" } });
  const alice = await prisma.user.findUniqueOrThrow({ where: { privyUserId: "dev:alice@example.com" } });
  const bob = await prisma.user.findUniqueOrThrow({ where: { privyUserId: "dev:bob@example.com" } });

  // Make bob a referee of alice (alice earns the referral third of bob's rake).
  await prisma.user.update({ where: { id: alice.id }, data: { referredById: null } });
  await prisma.user.update({ where: { id: bob.id }, data: { referredById: alice.id } });

  // Reset table + locked funds.
  await prisma.hand.deleteMany({ where: { tableId: table.id } });
  for (const u of [alice, bob]) {
    const bal = await prisma.balance.findUnique({ where: { userId_asset: { userId: u.id, asset: "SOL" } } });
    if (bal && bal.lockedAmount > 0n)
      await cashOutSeat({ userId: u.id, asset: "SOL", amount: bal.lockedAmount, tableId: table.id, correlationId: `rake-reset:${u.id}:${Date.now()}` });
  }

  const aliceRefBefore = (await prisma.balance.findUnique({ where: { userId_asset: { userId: alice.id, asset: "SOL" } } }))?.referralEarningsAmount ?? 0n;

  const buyIn = parseSolToLamports("1");
  await lockBuyIn({ userId: alice.id, asset: "SOL", amount: buyIn, tableId: table.id, correlationId: `rake-buyin:${alice.id}:${Date.now()}` });
  await lockBuyIn({ userId: bob.id, asset: "SOL", amount: buyIn, tableId: table.id, correlationId: `rake-buyin:${bob.id}:${Date.now()}` });
  const lockedBefore = buyIn * 2n;

  let handId = "";
  await new Promise<void>((resolve) => {
    const room = new TableRoom(
      { tableId: table.id, name: table.name, asset: table.asset, smallBlind: SB, bigBlind: BB, maxSeats: table.maxSeats, actionTimeoutSeconds: 30, rakeBps: RAKE_BPS },
      { send: (pid, ev) => onEvent(room, pid, ev), broadcast: () => {} },
    );
    let done = false;
    attachHandPersistence(room, { id: table.id, asset: table.asset }, {
      afterHandCompleted: (info) => {
        if (done) return;
        done = true;
        handId = `${table.id}:${info.handNumber}`;
        room.setSitOut(alice.id, true);
        room.setSitOut(bob.id, true);
        setTimeout(resolve, 1000);
      },
    });
    // Auto-pilot: always check or call -> hand reaches the flop, generating rake.
    function onEvent(r: TableRoom, pid: string, ev: ServerEvent) {
      if (ev.t === "ACTION_REQUIRED") {
        const toCall = BigInt(ev.toCall);
        setImmediate(() => r.handleAction(pid, toCall > 0n ? "CALL" : "CHECK"));
      }
    }
    room.sit({ playerId: alice.id, displayName: "alice", seatNumber: 0, stack: buyIn });
    room.sit({ playerId: bob.id, displayName: "bob", seatNumber: 1, stack: buyIn });
  });

  const dbHand = await prisma.hand.findFirstOrThrow({ where: { tableId: table.id }, orderBy: { handNumber: "desc" } });

  // Settlement is fire-and-forget from the engine; poll until it has committed.
  for (let i = 0; i < 40; i++) {
    const n = await prisma.ledgerEntry.count({ where: { handId: dbHand.id, reason: "POT_AWARDED" } });
    if (n > 0) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  console.log(`\nHand ${dbHand.handNumber}: pot ${dbHand.potAmount}, rake ${dbHand.rakeAmount}`);

  // Expected rake (flop is always seen here since both check/call down).
  const expectedRake = computeRake({ pot: dbHand.potAmount, rakeBps: RAKE_BPS, bigBlind: BB, flopSeen: true });
  assert(dbHand.rakeAmount === expectedRake && expectedRake > 0n, `rake taken = 3% of pot capped (${expectedRake})`);

  const team = await sumLeg(dbHand.id, "TEAM_REVENUE");
  const buyback = await sumLeg(dbHand.id, "BUYBACK_RESERVE");
  const referral = await sumLeg(dbHand.id, "USER_REFERRAL_EARNINGS");
  assert(team + buyback + referral === expectedRake, `rake split sums to the rake (${team}+${buyback}+${referral})`);

  const split = splitRakeThreeWays(expectedRake);
  assert(buyback === split.buyback, `buyback third correct (${buyback})`);
  // bob contributed to the pot and is referred by alice, so alice earned a referral cut.
  assert(referral > 0n, `referral earnings credited to the referrer (${referral})`);

  const aliceRefAfter = (await prisma.balance.findUnique({ where: { userId_asset: { userId: alice.id, asset: "SOL" } } }))?.referralEarningsAmount ?? 0n;
  assert(aliceRefAfter - aliceRefBefore === referral, "referrer's claimable referral balance increased by the credited amount");

  // Conservation: table-locked total dropped by exactly the rake.
  let lockedAfter = 0n;
  for (const u of [alice, bob]) {
    const b = await prisma.balance.findUniqueOrThrow({ where: { userId_asset: { userId: u.id, asset: "SOL" } } });
    lockedAfter += b.lockedAmount;
  }
  assert(lockedBefore - lockedAfter === expectedRake, `table-locked funds dropped by exactly the rake (${lockedBefore - lockedAfter})`);

  // Claim: referral earnings move to available.
  const availBefore = (await reconcileUserBalance(alice.id, "SOL")).ledgerAvailable;
  const claimed = await claimReferralEarnings({ userId: alice.id, asset: "SOL", correlationId: `rake-claim:${alice.id}:${Date.now()}` });
  const availAfter = (await reconcileUserBalance(alice.id, "SOL")).ledgerAvailable;
  assert(claimed === aliceRefAfter, `claim moved the full referral balance (${claimed})`);
  assert(availAfter - availBefore === claimed, "claimed amount landed in available balance");
  const recon = await reconcileUserBalance(alice.id, "SOL");
  assert(recon.ok && recon.cachedReferral === 0n, "referrer balance reconciles and referral bucket is emptied");

  // Cleanup.
  for (const u of [alice, bob]) {
    const b = await prisma.balance.findUniqueOrThrow({ where: { userId_asset: { userId: u.id, asset: "SOL" } } });
    if (b.lockedAmount > 0n) await cashOutSeat({ userId: u.id, asset: "SOL", amount: b.lockedAmount, tableId: table.id, correlationId: `rake-cashout:${u.id}:${Date.now()}` });
  }
  await prisma.user.update({ where: { id: bob.id }, data: { referredById: null } });

  void handId;
  console.log("\n✅ RAKE + REFERRAL CHECKS PASSED");
}

main()
  .catch((e) => {
    console.error("\n❌ FAILED:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
