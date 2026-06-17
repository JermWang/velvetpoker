import { NextResponse } from "next/server";
import type { Asset } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth/require-user";
import { claimReferralEarnings } from "@/lib/ledger/ledger";
import { tooMany } from "@/lib/security/rate-limit";

/**
 * Claim all accrued referral earnings (SOL + USDC) into the user's available
 * balance, which can then be withdrawn from the cashier.
 */
export async function POST(req: Request) {
  const limited = tooMany(req, "referral-claim", { capacity: 10, refillPerSec: 0.2 });
  if (limited) return limited;

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const assets: Asset[] = ["SOL", "USDC"];
  const claimed: Record<string, string> = {};
  for (const asset of assets) {
    const amount = await claimReferralEarnings({
      userId: user.id,
      asset,
      correlationId: `referral-claim:${user.id}:${asset}:${Date.now()}`,
    });
    claimed[asset] = amount.toString();
  }

  return NextResponse.json({ claimed });
}
