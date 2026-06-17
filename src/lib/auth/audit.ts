/**
 * Audit log writer. Every privileged/admin action must call this so there is a
 * tamper-evident trail. Append-only by convention.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

type Tx = Prisma.TransactionClient;

export async function writeAuditLog(
  params: {
    actorUserId?: string | null;
    action: string;
    targetType: string;
    targetId: string;
    metadata?: Record<string, unknown>;
  },
  tx?: Tx,
): Promise<void> {
  const db = tx ?? prisma;
  await db.auditLog.create({
    data: {
      actorUserId: params.actorUserId ?? null,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      metadata: params.metadata as Prisma.InputJsonValue | undefined,
    },
  });
}
