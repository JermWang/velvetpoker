/**
 * Privy server-side client + token verification.
 *
 * Privy handles auth + embedded Solana wallet onboarding on the client. The
 * server verifies the Privy access token to establish identity. No custodial
 * signing happens on the client; the server owns hot/treasury keys.
 */

import { PrivyClient } from "@privy-io/server-auth";
import { env } from "@/lib/env";

let client: PrivyClient | null = null;

export function getPrivyClient(): PrivyClient | null {
  if (!env.privyAppId || !env.privyAppSecret) return null;
  if (!client) {
    client = new PrivyClient(env.privyAppId, env.privyAppSecret);
  }
  return client;
}

export interface SessionIdentity {
  privyUserId: string;
  email: string | null;
  /** Server-fetched Solana wallet addresses bound to the verified token. */
  wallets: string[];
}

/**
 * Verify a Privy access token and return the identity, or null if invalid /
 * Privy is not configured. Wallet addresses and email are fetched server-side
 * from the verified Privy user — never trusted from the browser.
 */
export async function verifyPrivyToken(
  token: string | undefined | null,
): Promise<SessionIdentity | null> {
  if (!token) return null;
  const privy = getPrivyClient();
  if (!privy) return null;

  let privyUserId: string;
  try {
    const claims = await privy.verifyAuthToken(token);
    privyUserId = claims.userId;
  } catch {
    return null;
  }

  let email: string | null = null;
  const wallets: string[] = [];
  try {
    const user = await privy.getUser(privyUserId);
    const accounts = (user.linkedAccounts ?? []) as unknown as Array<{
      type?: string;
      chainType?: string;
      address?: unknown;
    }>;
    for (const acct of accounts) {
      if (
        acct.type === "wallet" &&
        acct.chainType === "solana" &&
        typeof acct.address === "string"
      ) {
        wallets.push(acct.address);
      }
      if (!email && acct.type === "email" && typeof acct.address === "string") {
        email = acct.address;
      }
    }
  } catch {
    // Token verified but profile fetch failed; proceed with id only.
  }

  return { privyUserId, email, wallets };
}
