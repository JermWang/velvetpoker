/**
 * Short-lived signed WebSocket tickets.
 *
 * The web app (which holds the verified Privy session) mints a ticket bound to
 * the resolved userId; the realtime server verifies it on the handshake. This
 * keeps the long-lived Privy access token out of WS URLs (and out of server
 * access logs), and means the ws never needs to verify Privy tokens itself.
 *
 * The signing key is derived from the Privy app secret, which both deployments
 * already share — so no new env var is required. It is namespaced so it is not
 * the raw secret.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

const DEFAULT_TTL_MS = 60_000; // a ticket is only needed for the initial connect

function ticketKey(): Buffer {
  const base = env.privyAppSecret || "velvet-local-dev-secret";
  return createHmac("sha256", base).update("velvet-ws-ticket-v1").digest();
}

function sign(payload: string): string {
  return createHmac("sha256", ticketKey()).update(payload).digest("hex");
}

/** Mint a ticket binding `userId`, valid for `ttlMs`. */
export function signWsTicket(userId: string, ttlMs = DEFAULT_TTL_MS): string {
  const exp = Date.now() + ttlMs;
  const payload = `${userId}:${exp}`;
  return Buffer.from(`${payload}:${sign(payload)}`, "utf8").toString("base64url");
}

/** Verify a ticket; returns the bound userId if valid and unexpired, else null. */
export function verifyWsTicket(ticket: string): string | null {
  try {
    const decoded = Buffer.from(ticket, "base64url").toString("utf8");
    const parts = decoded.split(":");
    if (parts.length !== 3) return null;
    const [userId, expStr, sig] = parts as [string, string, string];
    const expected = sign(`${userId}:${expStr}`);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const exp = Number(expStr);
    if (!userId || !Number.isFinite(exp) || Date.now() > exp) return null;
    return userId;
  } catch {
    return null;
  }
}
