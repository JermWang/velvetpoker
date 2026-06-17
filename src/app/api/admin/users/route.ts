import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { prisma } from "@/lib/db/prisma";
import { writeAuditLog } from "@/lib/auth/audit";
import { recordRiskEvent } from "@/lib/risk/risk-events";

const schema = z.object({
  userId: z.string(),
  action: z.enum(["suspend", "activate", "block"]),
  note: z.string().max(480).optional(),
});

export async function POST(req: Request) {
  const admin = await requireAdmin();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const { userId, action, note } = parsed.data;

  const status =
    action === "suspend" ? "SUSPENDED" : action === "block" ? "BLOCKED" : "ACTIVE";

  await prisma.user.update({ where: { id: userId }, data: { status } });
  await writeAuditLog({
    actorUserId: admin.id,
    action: `USER_${action.toUpperCase()}`,
    targetType: "User",
    targetId: userId,
    metadata: { note },
  });
  await recordRiskEvent({
    userId,
    type: "ADMIN_ACTION",
    severity: action === "block" ? "HIGH" : "MEDIUM",
    metadata: { action, by: admin.id, note },
  });

  return NextResponse.json({ ok: true });
}
