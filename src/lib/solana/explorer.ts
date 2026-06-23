/**
 * Block-explorer link helpers. We standardize on Solscan for all on-chain
 * transaction links so players can independently confirm every deposit,
 * withdrawal, and outcome anchor. The cluster query param is derived from the
 * configured network so links resolve to the right chain.
 *
 * Server-only: reads env.solanaNetwork (not a NEXT_PUBLIC value). For client
 * components, build the URL server-side and pass it down.
 */

import { env } from "@/lib/env";

/** Solscan URL for a transaction signature on the configured cluster. */
export function solscanTxUrl(signature: string): string {
  if (env.solanaNetwork === "mainnet-beta") {
    return `https://solscan.io/tx/${signature}`;
  }
  const cluster = env.solanaNetwork === "testnet" ? "testnet" : "devnet";
  return `https://solscan.io/tx/${signature}?cluster=${cluster}`;
}

/** Solscan URL for an account/address on the configured cluster. */
export function solscanAddressUrl(address: string): string {
  if (env.solanaNetwork === "mainnet-beta") {
    return `https://solscan.io/account/${address}`;
  }
  const cluster = env.solanaNetwork === "testnet" ? "testnet" : "devnet";
  return `https://solscan.io/account/${address}?cluster=${cluster}`;
}
