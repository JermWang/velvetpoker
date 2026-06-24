import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/require-user";
import { scanTreasuryDeposits } from "@/lib/solana/deposits";
import { tooMany } from "@/lib/security/rate-limit";

/**
 * On-demand deposit credit. Runs the SAME treasury scan + attribution the
 * background monitor runs every ~15s — just immediately, so a fresh wallet→
 * treasury transfer (e.g. an at-the-table buy-in deposit) credits right away
 * instead of waiting for the next loop. No new money path: it delegates to
 * scanTreasuryDeposits(), which is idempotent on txSignature and attributes
 * each transfer to the user whose linked wallet sent it.
 */
export async function POST(req: Request) {
  // Throttle: this kicks an RPC scan, so keep it modest per user/IP.
  const limited = tooMany(req, "scan-deposits", { capacity: 8, refillPerSec: 0.2 });
  if (limited) return limited;

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const r = await scanTreasuryDeposits();
    return NextResponse.json({ credited: r.credited, unattributed: r.unattributed });
  } catch {
    return NextResponse.json({ error: "Deposit scan failed" }, { status: 500 });
  }
}
