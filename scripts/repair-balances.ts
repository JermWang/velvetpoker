/**
 * Dev-only: realign cached balances to the authoritative ledger for seeded
 * dev users. Residue from crashed verify runs can leave the denormalized
 * Balance cache out of sync with the ledger entries (the source of truth).
 * Scoped to privyUserId starting "dev:" so it can never touch real accounts.
 *
 * Run: npx tsx --env-file=.env scripts/repair-balances.ts
 */

import { prisma } from "../src/lib/db/prisma";
import { reconcileUserBalance } from "../src/lib/ledger/ledger";

async function main() {
  const users = await prisma.user.findMany({ where: { privyUserId: { startsWith: "dev:" } } });
  let repaired = 0;
  for (const u of users) {
    const balances = await prisma.balance.findMany({ where: { userId: u.id } });
    for (const bal of balances) {
      const rec = await reconcileUserBalance(u.id, bal.asset);
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
  console.log(repaired === 0 ? "Nothing to repair — all dev balances reconcile." : `Repaired ${repaired} balance(s).`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
