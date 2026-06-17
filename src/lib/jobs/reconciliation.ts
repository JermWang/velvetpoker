/**
 * Reconciliation job. Verifies that every cached Balance row matches the sum of
 * its ledger entries. Any mismatch is a serious integrity issue and is recorded
 * as a CRITICAL risk event for immediate review.
 */

import { prisma } from "@/lib/db/prisma";
import { reconcileUserBalance } from "@/lib/ledger/ledger";
import { recordRiskEvent } from "@/lib/risk/risk-events";

export async function runReconciliationOnce(): Promise<{
  checked: number;
  mismatches: number;
}> {
  const balances = await prisma.balance.findMany();
  let mismatches = 0;

  for (const b of balances) {
    const r = await reconcileUserBalance(b.userId, b.asset);
    if (!r.ok) {
      mismatches++;
      await recordRiskEvent({
        userId: b.userId,
        type: "ADMIN_ACTION",
        severity: "CRITICAL",
        metadata: {
          kind: "balance_reconciliation_mismatch",
          asset: b.asset,
          cachedAvailable: r.cachedAvailable.toString(),
          ledgerAvailable: r.ledgerAvailable.toString(),
          cachedLocked: r.cachedLocked.toString(),
          ledgerLocked: r.ledgerLocked.toString(),
        },
      });
    }
  }
  return { checked: balances.length, mismatches };
}

if (process.argv[1] && process.argv[1].includes("reconciliation")) {
  void runReconciliationOnce().then((r) => {
    console.log(`[reconciliation] checked ${r.checked}, mismatches ${r.mismatches}`);
    process.exit(r.mismatches > 0 ? 1 : 0);
  });
}
