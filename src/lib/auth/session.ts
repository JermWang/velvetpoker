/**
 * Resolve the current session identity from request cookies.
 *
 * Production: a verified Privy access token (cookie `privy-token`).
 * Development: when Privy is not configured, a `velvet_dev_user` cookie holding
 * an email is accepted so the full app can be exercised locally. This dev path
 * is gated on Privy being absent and is clearly separated from prod logic.
 */

import { cookies, headers } from "next/headers";
import { env } from "@/lib/env";
import { verifyPrivyToken, type SessionIdentity } from "./privy";

export async function getSessionIdentity(): Promise<SessionIdentity | null> {
  const store = cookies();

  // Prefer a fresh Bearer token from the client (Authorization header) over the
  // privy-token cookie, which can go stale/expired while the client SDK still
  // holds a valid token. Route handlers get the header from authedFetch; server
  // components fall back to the cookie (no header on a browser navigation).
  let bearer: string | undefined;
  try {
    const authz = headers().get("authorization");
    if (authz && /^bearer\s+/i.test(authz)) bearer = authz.replace(/^bearer\s+/i, "").trim();
  } catch {
    /* headers() unavailable in this context — fall back to the cookie */
  }
  const privyToken = bearer || store.get("privy-token")?.value;
  if (env.privyAppId && env.privyAppSecret) {
    return verifyPrivyToken(privyToken);
  }

  // Dev fallback (Privy not configured). Never used when Privy creds are set.
  if (!env.isProduction) {
    const devEmail = store.get("velvet_dev_user")?.value;
    if (devEmail) {
      return {
        privyUserId: `dev:${devEmail.toLowerCase()}`,
        email: devEmail,
        wallets: [],
      };
    }
  }
  return null;
}
