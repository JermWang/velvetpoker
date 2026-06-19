/**
 * Dev-only: heal seeded dev users' ledgers after crashed verify runs.
 * Scoped to privyUserId starting "dev:" so it can never touch real accounts.
 *
 * Two repairs, in order:
 *   1. Lift any NEGATIVE locked/referral account back to zero with a balanced
 *      ADMIN_ADJUSTMENT (sourced from available). A negative account is invalid
 *      and wedges the user — the ledger guard refuses every later op — so we
 *      post the corrective entries directly here.
 *   2. Realign the denormalized Balance cache to the authoritative ledger sum.
 *
 * Run: npx tsx --env-file=.env scripts/repair-balances.ts
 */

import type { Asset } from "@prisma/client";
import { prisma } from "../src/lib/db/prisma";
import { reconcileUserBalance } from "../src/lib/ledger/ledger";

/**
 * Post a balanced ADMIN_ADJUSTMENT straight to the rows, bypassing the
 * high-level ledger primitives (which refuse to operate while an account is
 * already negative), to lift a negative locked/referral account to zero.
 */
async function liftNegativeToZero(
  userId: string,
  asset: Asset,
  account: "USER_TABLE_LOCKED" | "USER_REFERRAL_EARNINGS",
  deficit: bigint,
): Promise<void> {
  const correlationId = `repair-negative:${userId}:${asset}:${Date.now()}`;
  await prisma.$transaction([
    prisma.ledgerEntry.create({
      data: { userId, asset, amount: deficit, direction: "CREDIT", accountType: account, reason: "ADMIN_ADJUSTMENT", correlationId },
    }),
    prisma.ledgerEntry.create({
      data: { userId, asset, amount: deficit, direction: "DEBIT", accountType: "USER_AVAILABLE", reason: "ADMIN_ADJUSTMENT", correlationId },
    }),
  ]);
}

async function main() {
  const users = await prisma.user.findMany({ where: { privyUserId: { startsWith: "dev:" } } });
  let repaired = 0;
  for (const u of users) {
    const balances = await prisma.balance.findMany({ where: { userId: u.id } });
    for (const bal of balances) {
      let rec = await reconcileUserBalance(u.id, bal.asset);

      // 1) Lift negative accounts back to zero (invalid state from crashed runs).
      if (rec.ledgerLocked < 0n) {
        console.log(`${u.privyUserId} ${bal.asset}: lifting negative locked ${rec.ledgerLocked} -> 0`);
        await liftNegativeToZero(u.id, bal.asset, "USER_TABLE_LOCKED", -rec.ledgerLocked);
      }
      if (rec.ledgerReferral < 0n) {
        console.log(`${u.privyUserId} ${bal.asset}: lifting negative referral ${rec.ledgerReferral} -> 0`);
        await liftNegativeToZero(u.id, bal.asset, "USER_REFERRAL_EARNINGS", -rec.ledgerReferral);
      }

      // 2) Realign cache -> ledger.
      rec = await reconcileUserBalance(u.id, bal.asset);
      if (rec.ok) continue;
      console.log(`${u.privyUserId} ${bal.asset}: realigning cache -> ledger`);
      console.log(`  available ${rec.cachedAvailable} -> ${rec.ledgerAvailable}`);
      console.log(`  locked    ${rec.cachedLocked} -> ${rec.ledgerLocked}`);
      console.log(`  referral  ${rec.cachedReferral} -> ${rec.ledgerReferral}`);
      await prisma.balance.update({
        where: { userId_asset: { userId: u.id, asset: bal.asset } },
        data: {
          availableAmount: rec.ledgerAvailable,
          lockedAmount: rec.ledgerLocked,
          referralEarningsAmount: rec.ledgerReferral,
        },
      });
      repaired += 1;
    }
  }
  console.log(repaired === 0 ? "Cache realignment: nothing to do." : `Realigned ${repaired} balance(s).`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
