import { NextResponse } from "next/server";
import type { Asset } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth/require-user";
import { claimReferralEarnings } from "@/lib/ledger/ledger";

/**
 * Claim all accrued referral earnings (SOL + USDC) into the user's available
 * balance, which can then be withdrawn from the cashier.
 */
export async function POST() {
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
