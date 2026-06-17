import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/require-user";
import { prisma } from "@/lib/db/prisma";
import { parseAmount } from "@/lib/ledger/money";
import { getComplianceProvider } from "@/lib/compliance/gates";
import { writeAuditLog } from "@/lib/auth/audit";
import { recordRiskEvent } from "@/lib/risk/risk-events";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("verifyAge") }),
  z.object({ action: z.literal("startKyc"), country: z.string().length(2).optional() }),
  z.object({ action: z.literal("setDepositLimit"), amount: z.string() }),
  z.object({ action: z.literal("selfExclude"), days: z.number().int().min(1).max(3650) }),
  z.object({ action: z.literal("setDisplayName"), name: z.string().min(2).max(32) }),
]);

export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const body = parsed.data;

  switch (body.action) {
    case "verifyAge": {
      await prisma.user.update({
        where: { id: user.id },
        data: { ageVerifiedAt: new Date() },
      });
      break;
    }
    case "startKyc": {
      const provider = getComplianceProvider();
      const country = body.country ?? user.country ?? "US";
      const [kyc, geo, sanctions] = await Promise.all([
        provider.checkKyc({ userId: user.id, email: user.email, declaredCountry: country }),
        provider.checkGeo({ userId: user.id, declaredCountry: country }),
        provider.checkSanctions({ userId: user.id, declaredCountry: country }),
      ]);
      await prisma.user.update({
        where: { id: user.id },
        data: {
          country,
          kycStatus: kyc.decision === "APPROVED" ? "APPROVED" : kyc.decision === "REJECTED" ? "REJECTED" : "PENDING",
          geofenceStatus: geo.decision === "ALLOWED" ? "ALLOWED" : geo.decision === "BLOCKED" ? "BLOCKED" : "UNKNOWN",
          status: sanctions.blocked ? "BLOCKED" : user.status,
        },
      });
      if (sanctions.blocked) {
        await recordRiskEvent({
          userId: user.id,
          type: "KYC_FAILED",
          severity: "HIGH",
          metadata: { reason: "sanctions_match", list: sanctions.matchedList },
        });
      }
      break;
    }
    case "setDepositLimit": {
      const amount = parseAmount("SOL", body.amount);
      await prisma.user.update({
        where: { id: user.id },
        data: { depositLimitDaily: amount },
      });
      break;
    }
    case "selfExclude": {
      const until = new Date(Date.now() + body.days * 86_400_000);
      await prisma.user.update({
        where: { id: user.id },
        data: { status: "SELF_EXCLUDED", selfExcludedUntil: until },
      });
      await recordRiskEvent({
        userId: user.id,
        type: "RESPONSIBLE_GAMING_LIMIT",
        severity: "MEDIUM",
        metadata: { kind: "self_exclusion", until: until.toISOString() },
      });
      break;
    }
    case "setDisplayName": {
      await prisma.user.update({
        where: { id: user.id },
        data: { displayName: body.name },
      });
      break;
    }
  }

  await writeAuditLog({
    actorUserId: user.id,
    action: `ACCOUNT_${body.action.toUpperCase()}`,
    targetType: "User",
    targetId: user.id,
  });

  return NextResponse.json({ ok: true });
}
