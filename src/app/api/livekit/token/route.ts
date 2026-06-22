import { NextResponse } from "next/server";
import { z } from "zod";
import { AccessToken } from "livekit-server-sdk";
import { getCurrentUser } from "@/lib/auth/require-user";
import { prisma } from "@/lib/db/prisma";
import { env, isLiveKitConfigured } from "@/lib/env";
import { tooMany } from "@/lib/security/rate-limit";

const schema = z.object({
  tableId: z.string().min(1),
  // The caller's opaque per-table seat token (from the ws IDENTITY event). Used
  // as the LiveKit identity so other clients can map each video tile to the
  // right seat (seat.playerId === participant.identity). Falls back to userId.
  seatToken: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,32}$/)
    .optional(),
});

/** LiveKit room name for a table — stable, namespaced so it can't collide. */
function tableRoomName(tableId: string): string {
  return `vp-table-${tableId}`;
}

// Mints a short-lived LiveKit access token so a signed-in player can join their
// table's voice/video room. Identity is the userId (so seats can map tracks to
// players); display name is the chosen handle. Token grants publish+subscribe.
export async function POST(req: Request) {
  if (!isLiveKitConfigured()) {
    return NextResponse.json(
      { error: "Voice/video is not enabled" },
      { status: 503 },
    );
  }

  const limited = tooMany(req, "livekit-token", { capacity: 20, refillPerSec: 0.5 });
  if (limited) return limited;

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const table = await prisma.pokerTable.findUnique({
    where: { id: parsed.data.tableId },
    select: { id: true },
  });
  if (!table) {
    return NextResponse.json({ error: "Table not found" }, { status: 404 });
  }

  const room = tableRoomName(table.id);
  // Prefix the seat token so it can't collide with a raw cuid userId namespace.
  const identity = parsed.data.seatToken
    ? `seat:${parsed.data.seatToken}`
    : user.id;
  const at = new AccessToken(env.livekitApiKey, env.livekitApiSecret, {
    identity,
    name: user.displayName ?? "Player",
    // Tokens are short-lived; the client re-fetches on (re)connect.
    ttl: "1h",
  });
  at.addGrant({
    room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  return NextResponse.json({ token: await at.toJwt(), url: env.livekitUrl, room });
}
