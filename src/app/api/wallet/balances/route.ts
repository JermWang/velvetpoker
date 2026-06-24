import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/require-user";
import { prisma } from "@/lib/db/prisma";
import { getSolanaProvider } from "@/lib/solana/connection";
import { getUserBalances } from "@/lib/queries";

export const dynamic = "force-dynamic";

// On-chain wallet reads hit the RPC, so memo them briefly per address. The
// in-app (playable) balances are a cheap DB read and must stay FRESH so a
// buy-in's charge shows in the nav right away — they are never cached.
interface Cached {
  at: number;
  balances: Array<{ asset: string; amount: string }>;
}
const walletCache = new Map<string, Cached>();
const TTL_MS = 12_000;

/**
 * Balances for the nav:
 *  - `playable`: in-app deposited funds (available + locked-in-play). Buy-ins,
 *    wins, and losses move THIS — it is the poker balance.
 *  - `wallet`: on-chain SOL + USDC in the connected wallet (only deposits /
 *    withdrawals move this; gameplay never touches it).
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // In-app playable balance — fresh every call so a charge is visible at once.
  const playable = (await getUserBalances(user.id)).map((b) => ({
    asset: b.asset,
    available: b.available.toString(),
    locked: b.locked.toString(),
  }));

  const wallet = await prisma.wallet.findFirst({
    where: { userId: user.id, chain: "SOLANA" },
    orderBy: { createdAt: "asc" },
  });

  let walletBalances: Array<{ asset: string; amount: string }> = [];
  if (wallet) {
    const now = Date.now();
    const hit = walletCache.get(wallet.address);
    if (hit && now - hit.at < TTL_MS) {
      walletBalances = hit.balances;
    } else {
      const provider = getSolanaProvider();
      let sol = 0n;
      let usdc = 0n;
      try {
        [sol, usdc] = await Promise.all([
          provider.getOnChainBalance(wallet.address, "SOL"),
          provider.getOnChainBalance(wallet.address, "USDC"),
        ]);
      } catch {
        // RPC hiccup — return zeros rather than 500ing the whole nav.
      }
      walletBalances = [
        { asset: "SOL", amount: sol.toString() },
        { asset: "USDC", amount: usdc.toString() },
      ];
      walletCache.set(wallet.address, { at: now, balances: walletBalances });
    }
  }

  return NextResponse.json({
    address: wallet?.address ?? null,
    playable,
    wallet: walletBalances,
  });
}
