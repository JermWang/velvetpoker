/**
 * Deposit monitor job. Periodically scans the shared treasury address for new
 * confirmed transfers and credits the sending user's ledger (idempotent on tx
 * signature). Attribution is by sender — see scanTreasuryDeposits.
 *
 * Run as a cron/worker: `tsx src/lib/jobs/deposit-monitor.ts` or call
 * `runDepositMonitorOnce()` from a scheduler.
 */

import { scanTreasuryDeposits } from "@/lib/solana/deposits";

export async function runDepositMonitorOnce(): Promise<{
  credited: number;
  unattributed: number;
}> {
  return scanTreasuryDeposits();
}

export async function runDepositMonitorLoop(intervalMs = 15_000): Promise<void> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const r = await runDepositMonitorOnce();
      if (r.credited > 0) console.log(`[deposit-monitor] credited ${r.credited}`);
      if (r.unattributed > 0)
        console.warn(`[deposit-monitor] ${r.unattributed} unattributed transfer(s) to treasury`);
    } catch (err) {
      console.error("[deposit-monitor] error", err);
    }
    await new Promise((res) => setTimeout(res, intervalMs));
  }
}

if (process.argv[1] && process.argv[1].includes("deposit-monitor")) {
  void runDepositMonitorLoop();
}
