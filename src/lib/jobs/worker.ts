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
import { runReconciliationOnce } from "./reconciliation";

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
 * Start all background loops. Safe to call once at process startup (e.g. from
 * the realtime server, where it co-locates with the always-on ws process), or
 * as the entrypoint of a dedicated worker service. Loops never resolve.
 */
export function startBackgroundWorkers(): void {
  const onChain = Boolean(env.hotWalletPrivateKey && env.treasuryWalletAddress);
  console.log(
    `[worker] starting (network=${env.solanaNetwork}, on-chain=${onChain ? "live" : "mock"})`,
  );
  if (!onChain) {
    console.warn(
      "[worker] HOT_WALLET_PRIVATE_KEY and/or TREASURY_WALLET_ADDRESS not set — running with the mock Solana provider. Deposits/withdrawals will not touch mainnet until both are configured.",
    );
  }

  // Fire all loops; they never resolve. Any unexpected rejection is logged but
  // must not take the whole process down silently.
  void runDepositMonitorLoop().catch((e) => console.error("[deposit-monitor] fatal", e));
  void runWithdrawalProcessorLoop().catch((e) => console.error("[withdrawal-processor] fatal", e));
  void runReconciliationLoop().catch((e) => console.error("[reconciliation] fatal", e));
}

// Allow running as a standalone worker service: `tsx src/lib/jobs/worker.ts`.
if (process.argv[1] && process.argv[1].includes("worker")) {
  startBackgroundWorkers();
}
