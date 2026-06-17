import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import {
  approveWithdrawal,
  rejectWithdrawal,
  sendApprovedWithdrawal,
} from "@/lib/solana/withdrawals";
import { writeAuditLog } from "@/lib/auth/audit";

const schema = z.object({
  withdrawalId: z.string(),
  action: z.enum(["approve", "reject", "send"]),
  note: z.string().max(480).optional(),
});

export async function POST(req: Request) {
  const admin = await requireAdmin();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const { withdrawalId, action, note } = parsed.data;

  try {
    if (action === "approve") {
      await approveWithdrawal({ withdrawalId, reviewerUserId: admin.id, note });
    } else if (action === "reject") {
      await rejectWithdrawal({ withdrawalId, reviewerUserId: admin.id, note });
    } else {
      await sendApprovedWithdrawal(withdrawalId);
    }
    await writeAuditLog({
      actorUserId: admin.id,
      action: `WITHDRAWAL_${action.toUpperCase()}`,
      targetType: "Withdrawal",
      targetId: withdrawalId,
      metadata: { note },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Action failed" },
      { status: 400 },
    );
  }
}
