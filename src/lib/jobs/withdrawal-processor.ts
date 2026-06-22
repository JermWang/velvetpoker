/**
 * Withdrawal processor job. Sends APPROVED withdrawals on-chain. Items in
 * PENDING_REVIEW are left for an admin. Each send is idempotent (keyed on the
 * withdrawal id) and any failure unlocks the balance safely.
 */

import { prisma } from "@/lib/db/prisma";
import { sendApprovedWithdrawal } from "@/lib/solana/withdrawals";

export async function runWithdrawalProcessorOnce(): Promise<{ sent: number; failed: number }> {
  const approved = await prisma.withdrawal.findMany({
    where: { status: "APPROVED" },
    orderBy: { createdAt: "asc" },
    take: 25,
  });

  let sent = 0;
  let failed = 0;
  for (const w of approved) {
    try {
      const res = await sendApprovedWithdrawal(w.id);
      // Empty signature = the row was claimed/sent elsewhere (no-op, not a send).
      if (res.txSignature) sent++;
    } catch (err) {
      failed++;
      console.error(`[withdrawal-processor] ${w.id} failed`, err);
    }
  }
  return { sent, failed };
}

export async function runWithdrawalProcessorLoop(intervalMs = 20_000): Promise<void> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await runWithdrawalProcessorOnce();
    } catch (err) {
      console.error("[withdrawal-processor] error", err);
    }
    await new Promise((res) => setTimeout(res, intervalMs));
  }
}

if (process.argv[1] && process.argv[1].includes("withdrawal-processor")) {
  void runWithdrawalProcessorLoop();
}
