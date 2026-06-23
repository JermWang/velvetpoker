/**
 * Combined background worker. Runs the deposit monitor, withdrawal processor,
 * and periodic reconciliation in a single long-lived process. Deployed as its
 * own Railway service so on-chain settlement runs independently of the web/ws
 * request lifecycle.
 *
 * Run: `tsx src/lib/jobs/worker.ts` (or `npm run worker`).
 *
 * Safe to start without HOT_WALLET_PRIVATE_KEY / TREASURY_WALLET_ADDRESS: the
 * Solana provider falls back to the mock and the loops simply find nothing to do.
 */

import { env } from "@/lib/env";
import { runDepositMonitorLoop } from "./deposit-monitor";
import { runWithdrawalProcessorLoop } from "./withdrawal-processor";
import { runReconciliationOnce, reconcileTreasuryOnChain } from "./reconciliation";
import { runAnchorLoop } from "./anchor";

async function runReconciliationLoop(intervalMs = 5 * 60_000): Promise<void> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const r = await runReconciliationOnce();
      if (r.mismatches > 0)
        console.error(`[reconciliation] ${r.mismatches} mismatch(es) of ${r.checked}`);
    } catch (err) {
      console.error("[reconciliation] error", err);
    }
    await new Promise((res) => setTimeout(res, intervalMs));
  }
}

/**
 * Treasury solvency loop — only run with a real provider + treasury (gated by the
 * caller). Compares on-chain holdings to ledger liabilities and alerts CRITICAL
 * on any shortfall. Runs less often than the cache check (an RPC balance read).
 */
async function runTreasuryReconciliationLoop(intervalMs = 5 * 60_000): Promise<void> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const r = await reconcileTreasuryOnChain();
      if (r.shortfalls > 0)
        console.error(`[treasury-reconcile] ${r.shortfalls} shortfall(s) of ${r.checked}`);
    } catch (err) {
      console.error("[treasury-reconcile] error", err);
    }
    await new Promise((res) => setTimeout(res, intervalMs));
  }
}

/**
 * Start all background loops. Safe to call once at process startup (e.g. from
 * the realtime server, where it co-locates with the always-on ws process), or
 * as the entrypoint of a dedicated worker service. Loops never resolve.
 */
export function startBackgroundWorkers(): void {
  const onChain = Boolean(env.hotWalletPrivateKey && env.treasuryWalletAddress);
  console.log(
    `[worker] starting (network=${env.solanaNetwork}, on-chain=${onChain ? "live" : "mock"})`,
  );

  // Reconciliation is pure DB integrity checking — always safe to run.
  void runReconciliationLoop().catch((e) => console.error("[reconciliation] fatal", e));

  // The chain-writing loops (deposit detection, withdrawal sending, outcome
  // anchoring) only run once a real hot wallet + treasury are configured. In
  // mock mode they would write fake signatures / fake anchors into the live DB,
  // so we keep them idle until on-chain is genuinely enabled. Completed hands
  // simply accumulate as unanchored and get anchored on-chain once live.
  if (!onChain) {
    console.warn(
      "[worker] on-chain workers idle — set HOT_WALLET_PRIVATE_KEY (+ TREASURY_WALLET_ADDRESS) to enable deposits, withdrawals, and outcome anchoring on mainnet.",
    );
    return;
  }

  void runDepositMonitorLoop().catch((e) => console.error("[deposit-monitor] fatal", e));
  void runWithdrawalProcessorLoop().catch((e) => console.error("[withdrawal-processor] fatal", e));
  // Treasury solvency tripwire — only with the real provider (gated above).
  void runTreasuryReconciliationLoop().catch((e) =>
    console.error("[treasury-reconcile] fatal", e),
  );
  if (env.anchorEnabled) {
    void runAnchorLoop().catch((e) => console.error("[anchor] fatal", e));
  }
}

// Allow running as a standalone worker service: `tsx src/lib/jobs/worker.ts`.
if (process.argv[1] && process.argv[1].includes("worker")) {
  startBackgroundWorkers();
}
