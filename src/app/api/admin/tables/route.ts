import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { prisma } from "@/lib/db/prisma";
import { writeAuditLog } from "@/lib/auth/audit";

const schema = z.object({
  tableId: z.string(),
  action: z.enum(["pause", "resume", "close"]),
});

export async function POST(req: Request) {
  const admin = await requireAdmin();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const { tableId, action } = parsed.data;
  const status =
    action === "pause" ? "PAUSED" : action === "close" ? "CLOSED" : "WAITING";

  // Note: pause/close take effect for the NEXT hand; the realtime room finishes
  // the current hand before honoring the new status.
  await prisma.pokerTable.update({ where: { id: tableId }, data: { status } });
  await writeAuditLog({
    actorUserId: admin.id,
    action: `TABLE_${action.toUpperCase()}`,
    targetType: "PokerTable",
    targetId: tableId,
  });
  return NextResponse.json({ ok: true });
}
