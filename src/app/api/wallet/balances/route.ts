import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/require-user";
import { prisma } from "@/lib/db/prisma";
import { getSolanaProvider } from "@/lib/solana/connection";

export const dynamic = "force-dynamic";

// The nav polls this; a short per-address memo keeps rapid navigations from
// hammering the RPC. (web runs as a long-lived Node process, so this persists.)
interface Cached {
  at: number;
  data: { address: string; balances: Array<{ asset: string; amount: string }> };
}
const cache = new Map<string, Cached>();
const TTL_MS = 12_000;

/** The signed-in user's CONNECTED WALLET on-chain SOL + USDC balances. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const wallet = await prisma.wallet.findFirst({
    where: { userId: user.id, chain: "SOLANA" },
    orderBy: { createdAt: "asc" },
  });
  if (!wallet) return NextResponse.json({ address: null, balances: [] });

  const now = Date.now();
  const hit = cache.get(wallet.address);
  if (hit && now - hit.at < TTL_MS) return NextResponse.json(hit.data);

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
  const data = {
    address: wallet.address,
    balances: [
      { asset: "SOL", amount: sol.toString() },
      { asset: "USDC", amount: usdc.toString() },
    ],
  };
  cache.set(wallet.address, { at: now, data });
  return NextResponse.json(data);
}
