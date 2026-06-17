/**
 * Deposit destination.
 *
 * Custodial model (sender-attributed): there is ONE shared deposit address — the
 * treasury — and every user deposits to it directly from their connected Solana
 * wallet. The deposit-monitor watches the treasury and attributes each incoming
 * transfer to the user whose linked wallet sent it (see scanTreasuryDeposits).
 *
 * This intentionally avoids per-user deposit keypairs: no private keys to custody,
 * no sweeping, and funds land in the treasury on the first hop. The only key the
 * server holds is the hot wallet (for withdrawals), kept in env / a signing
 * service — never in the database.
 */

import { env } from "@/lib/env";

export interface DepositDestination {
  address: string;
}

/**
 * The address users send deposits to (the shared treasury). Attribution is by
 * sender, so no per-user address is created.
 */
export function getDepositDestination(): DepositDestination {
  const address = env.treasuryWalletAddress;
  if (!address) {
    throw new Error("TREASURY_WALLET_ADDRESS is not configured");
  }
  return { address };
}
