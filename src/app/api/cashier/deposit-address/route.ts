import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/require-user";
import { getDepositDestination } from "@/lib/solana/wallets";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Shared treasury address — deposits are attributed to the user by the
  // sending wallet, so users must deposit from their connected Solana wallet.
  const { address } = getDepositDestination();
  return NextResponse.json({ address });
}
