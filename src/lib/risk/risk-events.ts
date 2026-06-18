/**
 * Risk event recording. A thin, well-typed wrapper around the RiskEvent table
 * so detection logic (collusion, multi-account, geo, RG limits) has one place
 * to emit signals for the admin risk dashboard.
 */

import type {
  Prisma,
  RiskEventType,
  RiskSeverity,
} from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { sendRiskAlert } from "./alert";

type Tx = Prisma.TransactionClient;

export async function recordRiskEvent(
  params: {
    userId?: string | null;
    tableId?: string | null;
    handId?: string | null;
    type: RiskEventType;
    severity: RiskSeverity;
    metadata?: Record<string, unknown>;
  },
  tx?: Tx,
): Promise<void> {
  const db = tx ?? prisma;
  await db.riskEvent.create({
    data: {
      userId: params.userId ?? null,
      tableId: params.tableId ?? null,
      handId: params.handId ?? null,
      type: params.type,
      severity: params.severity,
      metadata: params.metadata as Prisma.InputJsonValue | undefined,
    },
  });

  // Best-effort external alert for serious events. Only when we own the write
  // (no caller transaction) so we never alert on a row that later rolls back.
  if (!tx && (params.severity === "HIGH" || params.severity === "CRITICAL")) {
    sendRiskAlert({
      type: params.type,
      severity: params.severity,
      userId: params.userId,
      metadata: params.metadata,
    });
  }
}
