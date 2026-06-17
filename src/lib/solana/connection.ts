/**
 * Solana RPC connection + provider resolution.
 *
 * In development (or whenever no hot wallet is configured) we use an in-memory
 * MockSolanaProvider so deposit/withdrawal flows can be exercised end-to-end
 * without a live chain. Production wires a real provider backed by web3.js and
 * a secure signer.
 */

import { Connection } from "@solana/web3.js";
import { env } from "@/lib/env";
import { MockSolanaProvider } from "./mock-provider";
import { Web3SolanaProvider } from "./web3-provider";
import type { SolanaProvider } from "./provider";

let connection: Connection | null = null;

export function getConnection(): Connection {
  if (!connection) {
    connection = new Connection(env.solanaRpcUrl, "confirmed");
  }
  return connection;
}

let provider: SolanaProvider | null = null;

export function getSolanaProvider(): SolanaProvider {
  if (provider) return provider;
  // Use the real chain provider once a hot wallet is configured (production /
  // devnet with real funds); otherwise the in-memory mock for local dev.
  provider = env.hotWalletPrivateKey
    ? new Web3SolanaProvider(getConnection())
    : new MockSolanaProvider();
  return provider;
}

/** Test/seed hook to inject a provider. */
export function setSolanaProvider(p: SolanaProvider): void {
  provider = p;
}
