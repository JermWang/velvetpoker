/**
 * Reconciliation job. Verifies that every cached Balance row matches the sum of
 * its ledger entries. Any mismatch is a serious integrity issue and is recorded
 * as a CRITICAL risk event for immediate review.
 */

import type { Asset } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { reconcileUserBalance, treasuryExpectedOnChain } from "@/lib/ledger/ledger";
import { recordRiskEvent } from "@/lib/risk/risk-events";
import { sendOpsAlert } from "@/lib/risk/alert";
import { getSolanaProvider } from "@/lib/solana/connection";
import { env } from "@/lib/env";

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

/**
 * Treasury solvency check: compare the REAL on-chain balance of the treasury/hot
 * wallet against the ledger's expected holdings (= total custodial liabilities)
 * per asset. A shortfall beyond tolerance means the float can't cover what users
 * are owed — theft, a stuck/duplicated send, a missed-but-spent deposit, or an
 * RPC mis-parse — and fires a CRITICAL alert. Only meaningful with the real
 * provider, so callers gate it to on-chain mode.
 */
export async function reconcileTreasuryOnChain(): Promise<{
  checked: number;
  shortfalls: number;
}> {
  const treasury = env.treasuryWalletAddress;
  if (!treasury) return { checked: 0, shortfalls: 0 };

  const provider = getSolanaProvider();
  const assets: Asset[] = ["SOL", "USDC"];
  if (env.tokenMint) assets.push("TOKEN");

  let shortfalls = 0;
  for (const asset of assets) {
    const [expected, actual] = await Promise.all([
      treasuryExpectedOnChain(asset),
      provider.getOnChainBalance(treasury, asset),
    ]);
    const tolerance =
      asset === "SOL" ? env.reconcileToleranceLamports : env.reconcileToleranceSpl;
    const shortfall = expected - actual; // > 0 means the treasury is under-funded

    if (shortfall > tolerance) {
      shortfalls++;
      const metadata = {
        kind: "treasury_onchain_shortfall",
        asset,
        expected: expected.toString(),
        actual: actual.toString(),
        shortfall: shortfall.toString(),
      };
      await recordRiskEvent({ type: "ADMIN_ACTION", severity: "CRITICAL", metadata });
      sendOpsAlert(
        `CRITICAL treasury shortfall ${asset}: on-chain ${actual} < ledger-owed ${expected} (short ${shortfall}). Funds may be missing — investigate immediately.`,
      );
    }
  }
  return { checked: assets.length, shortfalls };
}

if (process.argv[1] && process.argv[1].includes("reconciliation")) {
  void runReconciliationOnce().then((r) => {
    console.log(`[reconciliation] checked ${r.checked}, mismatches ${r.mismatches}`);
    process.exit(r.mismatches > 0 ? 1 : 0);
  });
}
