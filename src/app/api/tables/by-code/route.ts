import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/require-user";
import { prisma } from "@/lib/db/prisma";

/** Resolve a private-table invite code to its table id so the client can join. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const code = new URL(req.url).searchParams.get("code")?.trim();
  if (!code) return NextResponse.json({ error: "Missing code" }, { status: 400 });

  const table = await prisma.pokerTable.findUnique({
    where: { inviteCode: code },
    select: { id: true, status: true },
  });
  if (!table || table.status === "CLOSED") {
    return NextResponse.json({ error: "No table found for that code" }, { status: 404 });
  }
  return NextResponse.json({ id: table.id });
}
