import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/require-user";
import { getDepositDestination } from "@/lib/solana/wallets";
import { getConnection } from "@/lib/solana/connection";
import { tooMany } from "@/lib/security/rate-limit";

/**
 * Prep for an in-app (at-the-table) deposit: returns the treasury address the
 * client should send to, plus a fresh blockhash so the client can build the
 * transfer WITHOUT a client-side RPC (keeps the RPC key server-only). The client
 * signs it with the connected wallet (Privy), then calls /api/cashier/scan-deposits
 * to credit it. Public address + a blockhash only — nothing secret.
 */
export async function GET(req: Request) {
  const limited = tooMany(req, "deposit-prep", { capacity: 20, refillPerSec: 1 });
  if (limited) return limited;

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { address: treasury } = getDepositDestination();
    const { blockhash, lastValidBlockHeight } =
      await getConnection().getLatestBlockhash("confirmed");
    return NextResponse.json({ treasury, blockhash, lastValidBlockHeight });
  } catch {
    return NextResponse.json({ error: "Could not prepare deposit" }, { status: 500 });
  }
}
