/**
 * Withdrawal safety verification against the real DB. Proves the additive
 * guards on requestWithdrawal:
 *   - an identical in-flight withdrawal is refused (double-submit guard)
 *   - exceeding the rolling-window count forces PENDING_REVIEW (velocity)
 *   - funds are fully restored when the test withdrawals are rejected
 *
 * Self-cleaning: it rejects every withdrawal it creates (and any non-terminal
 * residue from a crashed prior run) so the dev ledger is left as it started.
 *
 * Run: npm run verify:withdraw
 */

import { prisma } from "../src/lib/db/prisma";
import { env } from "../src/lib/env";
import { requestWithdrawal, rejectWithdrawal } from "../src/lib/solana/withdrawals";
import { reconcileUserBalance } from "../src/lib/ledger/ledger";
import { formatLamportsToSol } from "../src/lib/ledger/money";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error("ASSERT FAILED: " + msg);
  console.log("  ✓ " + msg);
}

const SMALL = 1_000_000n; // 0.001 SOL — under the review threshold and tiny
const addr = (i: number) => "VeloTestAddr" + String(i).padStart(40, "0");

async function rejectAllNonTerminal(userId: string) {
  const open = await prisma.withdrawal.findMany({
    where: { userId, status: { in: ["REQUESTED", "PENDING_REVIEW", "APPROVED"] } },
  });
  for (const w of open) {
    await rejectWithdrawal({ withdrawalId: w.id, reviewerUserId: userId, note: "verify cleanup" });
  }
  return open.length;
}

async function main() {
  console.log("Velvet Poker — withdrawal safety verification\n");
  const alice = await prisma.user.findUniqueOrThrow({
    where: { privyUserId: "dev:alice@example.com" },
  });

  // Clear any non-terminal residue from a crashed prior run so velocity counts
  // start clean, then snapshot the starting balance.
  const cleared = await rejectAllNonTerminal(alice.id);
  if (cleared) console.log(`  (cleared ${cleared} non-terminal withdrawal(s) from a prior run)`);
  const start = await reconcileUserBalance(alice.id, "SOL");
  assert(start.ok, "alice's balance reconciles at start");
  assert(start.ledgerAvailable > 1_000_000_000n, "alice has enough available SOL to test");
  console.log(`  start available: ${formatLamportsToSol(start.ledgerAvailable)} SOL\n`);

  const MAX = env.withdrawalDailyMaxCount;
  assert(MAX >= 2 && MAX <= 50, `velocity count cap is a sane test value (${MAX})`);

  // 1) Velocity: the first MAX small withdrawals auto-approve; the next one is
  //    pushed to manual review purely because of the count.
  let approved = 0;
  for (let i = 0; i < MAX; i++) {
    const r = await requestWithdrawal({ userId: alice.id, asset: "SOL", amount: SMALL, toAddress: addr(i) });
    if (r.status === "APPROVED") approved++;
  }
  assert(approved === MAX, `first ${MAX} distinct small withdrawals auto-approved`);

  const overflow = await requestWithdrawal({ userId: alice.id, asset: "SOL", amount: SMALL, toAddress: addr(MAX) });
  assert(overflow.status === "PENDING_REVIEW" && overflow.requiresReview, `withdrawal #${MAX + 1} forced to review by velocity`);

  // 2) Double-submit guard: an identical in-flight request (same asset/amount/
  //    address as #0, which is APPROVED) is refused.
  let dupRejected = false;
  try {
    await requestWithdrawal({ userId: alice.id, asset: "SOL", amount: SMALL, toAddress: addr(0) });
  } catch (e) {
    dupRejected = /already in progress/i.test(String(e instanceof Error ? e.message : e));
  }
  assert(dupRejected, "an identical in-flight withdrawal is refused");

  // 3) Cleanup: reject everything we created; funds must return to available.
  const rejected = await rejectAllNonTerminal(alice.id);
  assert(rejected === MAX + 1, `all ${MAX + 1} test withdrawals rejected (funds unlocked)`);

  const end = await reconcileUserBalance(alice.id, "SOL");
  assert(end.ok, "alice's balance reconciles after cleanup");
  assert(end.ledgerAvailable === start.ledgerAvailable, "available SOL fully restored to the starting amount");

  console.log("\n✅ WITHDRAWAL SAFETY CHECKS PASSED");
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("\n❌ FAILED:", e);
  // Best-effort cleanup so a failure doesn't strand locked funds.
  try {
    const alice = await prisma.user.findUnique({ where: { privyUserId: "dev:alice@example.com" } });
    if (alice) await rejectAllNonTerminal(alice.id);
  } catch {}
  await prisma.$disconnect();
  process.exit(1);
});
