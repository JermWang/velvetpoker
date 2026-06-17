/**
 * Resolve the current session identity from request cookies.
 *
 * Production: a verified Privy access token (cookie `privy-token`).
 * Development: when Privy is not configured, a `velvet_dev_user` cookie holding
 * an email is accepted so the full app can be exercised locally. This dev path
 * is gated on Privy being absent and is clearly separated from prod logic.
 */

import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { verifyPrivyToken, type SessionIdentity } from "./privy";

export async function getSessionIdentity(): Promise<SessionIdentity | null> {
  const store = cookies();

  const privyToken = store.get("privy-token")?.value;
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
