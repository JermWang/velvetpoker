import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/require-user";
import { prisma } from "@/lib/db/prisma";
import { getOwnedNfts } from "@/lib/solana/helius-das";

export const dynamic = "force-dynamic";

/** NFTs held across the signed-in user's connected wallet(s), for the PFP picker. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const wallets = await prisma.wallet.findMany({
    where: { userId: user.id, chain: "SOLANA" },
  });
  if (wallets.length === 0) return NextResponse.json({ nfts: [] });

  try {
    const lists = await Promise.all(wallets.map((w) => getOwnedNfts(w.address)));
    const seen = new Set<string>();
    const nfts = lists.flat().filter((n) => {
      if (seen.has(n.id)) return false;
      seen.add(n.id);
      return true;
    });
    return NextResponse.json({ nfts });
  } catch {
    return NextResponse.json({
      nfts: [],
      error: "Couldn't load your NFTs right now.",
    });
  }
}
