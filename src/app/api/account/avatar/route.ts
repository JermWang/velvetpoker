import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/require-user";
import { prisma } from "@/lib/db/prisma";
import { writeAuditLog } from "@/lib/auth/audit";
import { tooMany } from "@/lib/security/rate-limit";

// Client resizes to a small square before upload; this is a hard server cap.
const MAX_BYTES = 400 * 1024; // 400 KB
const ALLOWED = /^data:(image\/(png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;

/** Upload (replace) the signed-in user's profile picture. */
export async function POST(req: Request) {
  const limited = tooMany(req, "avatar", { capacity: 6, refillPerSec: 0.05 });
  if (limited) return limited;

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { dataUrl?: string } | null;
  const m = body?.dataUrl ? ALLOWED.exec(body.dataUrl) : null;
  if (!m) {
    return NextResponse.json(
      { error: "Expected a base64 PNG, JPEG, or WebP image" },
      { status: 400 },
    );
  }
  const contentType = m[1]!;
  const data = Buffer.from(m[3]!, "base64");
  if (data.length === 0 || data.length > MAX_BYTES) {
    return NextResponse.json(
      { error: `Image must be 1 byte–${Math.floor(MAX_BYTES / 1024)} KB` },
      { status: 400 },
    );
  }

  await prisma.avatar.upsert({
    where: { userId: user.id },
    create: { userId: user.id, data, contentType },
    update: { data, contentType },
  });
  // Cache-bust the serve URL so the new image shows immediately.
  const avatarUrl = `/api/avatar/${user.id}?v=${Date.now()}`;
  await prisma.user.update({
    where: { id: user.id },
    data: { avatarUrl },
  });

  await writeAuditLog({
    actorUserId: user.id,
    action: "ACCOUNT_SET_AVATAR",
    targetType: "User",
    targetId: user.id,
  });

  return NextResponse.json({ avatarUrl });
}
