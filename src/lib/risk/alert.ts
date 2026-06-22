/**
 * Best-effort outbound alerting for serious risk events. Posts a compact JSON
 * payload to ALERT_WEBHOOK_URL (Slack and Discord both accept the shape, as do
 * generic webhooks). Fire-and-forget: it never throws, never blocks the caller,
 * and is a no-op when the webhook is unset — so it is safe to call from hot
 * paths and from the reconciliation loop.
 */

import type { RiskEventType, RiskSeverity } from "@prisma/client";
import { env } from "@/lib/env";

/**
 * Generic operational alert (crashes, worker failures, anything not modeled as a
 * RiskEvent). Same fire-and-forget contract as sendRiskAlert: never throws,
 * no-op when ALERT_WEBHOOK_URL is unset.
 */
export function sendOpsAlert(message: string): void {
  const url = env.alertWebhookUrl;
  if (!url) return;
  const text = `[velvet][ops] ${message}`.slice(0, 1500);
  const body = JSON.stringify({ text, content: text });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  void fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    signal: controller.signal,
  })
    .catch(() => {})
    .finally(() => clearTimeout(timer));
}

export function sendRiskAlert(params: {
  type: RiskEventType;
  severity: RiskSeverity;
  userId?: string | null;
  metadata?: Record<string, unknown>;
}): void {
  const url = env.alertWebhookUrl;
  if (!url) return;

  const text =
    `[velvet] ${params.severity} ${params.type}` +
    (params.userId ? ` user=${params.userId}` : "") +
    (params.metadata ? ` ${JSON.stringify(params.metadata)}` : "");

  // Slack expects { text }, Discord expects { content } — send a superset so a
  // single webhook URL works regardless of provider.
  const body = JSON.stringify({ text, content: text });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  void fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    signal: controller.signal,
  })
    .catch(() => {
      // Alerting must never affect the caller; swallow all errors.
    })
    .finally(() => clearTimeout(timer));
}
