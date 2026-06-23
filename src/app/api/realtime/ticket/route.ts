import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/require-user";
import { signWsTicket } from "@/lib/realtime/ws-ticket";
import { tooMany } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

// Mints a fresh, short-lived ws ticket for the current user. The table page
// embeds one at load, but it expires quickly — the client fetches a new one on
// every (re)connect so a socket dropped minutes later (server redeploy, sleep,
// network blip) can still re-authenticate instead of dying silently.
export async function GET(req: Request) {
  const limited = tooMany(req, "ws-ticket", { capacity: 30, refillPerSec: 1 });
  if (limited) return limited;

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json({ ticket: signWsTicket(user.id) });
}
