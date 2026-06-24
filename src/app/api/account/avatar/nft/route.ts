import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/require-user";
import { prisma } from "@/lib/db/prisma";
import { writeAuditLog } from "@/lib/auth/audit";
import { tooMany } from "@/lib/security/rate-limit";
import { getAssetImageIfOwned } from "@/lib/solana/helius-das";

export const dynamic = "force-dynamic";

/**
 * Set the signed-in user's profile picture to one of their VERIFIED-OWNED NFTs.
 * Ownership is re-checked on-chain (the client only sends an asset id), and the
 * stored URL is the asset's own image — only ever an http(s) URL safe to render.
 */
export async function POST(req: Request) {
  const limited = tooMany(req, "avatar", { capacity: 6, refillPerSec: 0.05 });
  if (limited) return limited;

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { assetId?: string } | null;
  const assetId = body?.assetId?.trim();
  if (!assetId) {
    return NextResponse.json({ error: "Missing NFT id" }, { status: 400 });
  }

  const wallets = await prisma.wallet.findMany({
    where: { userId: user.id, chain: "SOLANA" },
  });
  const owners = wallets.map((w) => w.address);
  if (owners.length === 0) {
    return NextResponse.json({ error: "No connected wallet" }, { status: 400 });
  }

  let imageUrl: string | null;
  try {
    imageUrl = await getAssetImageIfOwned(assetId, owners);
  } catch {
    return NextResponse.json(
      { error: "Couldn't verify that NFT right now" },
      { status: 502 },
    );
  }
  if (!imageUrl) {
    return NextResponse.json(
      { error: "That NFT isn't in your connected wallet" },
      { status: 403 },
    );
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { avatarUrl: imageUrl },
  });

  await writeAuditLog({
    actorUserId: user.id,
    action: "ACCOUNT_SET_AVATAR",
    targetType: "User",
    targetId: user.id,
  });

  return NextResponse.json({ avatarUrl: imageUrl });
}
