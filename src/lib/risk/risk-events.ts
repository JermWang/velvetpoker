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
import { sendRiskAlert, sendOpsAlert } from "./alert";

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

/**
 * Record a money-critical operational FAILURE as a CRITICAL RiskEvent — a durable
 * DB row visible via Supabase + the admin risk dashboard — and (via recordRiskEvent)
 * fire the ops webhook too if one is configured. Use for failures that must never
 * be silent (settlement write, cash-out, withdrawal send, seat restore). With this,
 * the DB is a complete monitoring surface even when no webhook is set. Never throws.
 */
export async function recordOpsFailure(
  detail: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await recordRiskEvent({
      type: "ADMIN_ACTION",
      severity: "CRITICAL",
      metadata: { kind: "ops_failure", detail, ...metadata },
    });
  } catch {
    // Last resort if even the DB write fails: hit the webhook directly.
    sendOpsAlert(detail);
  }
}
