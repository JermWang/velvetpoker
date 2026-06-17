/**
 * Chain provider abstraction for Solana. Deposit monitoring and withdrawal
 * sending depend on this interface, never on web3.js directly, so the chain can
 * be mocked in development and swapped for a hardened signing service in prod.
 *
 * Amounts are bigint base units (lamports for SOL, token base units for USDC).
 */

import type { Asset } from "@prisma/client";

export interface IncomingTransfer {
  txSignature: string;
  toAddress: string;
  fromAddress: string | null;
  asset: Asset;
  amount: bigint;
  confirmations: number;
  slot: number;
}

export interface SendResult {
  txSignature: string;
}

export interface SolanaProvider {
  readonly name: string;
  /** Confirmations for a given signature (0 if unknown / dropped). */
  getConfirmations(signature: string): Promise<number>;
  /** Incoming transfers to a watched address since an optional cursor slot. */
  getIncomingTransfers(
    address: string,
    sinceSlot?: number,
  ): Promise<IncomingTransfer[]>;
  /** Send an outbound transfer from the hot wallet. SERVER ONLY. */
  sendTransfer(params: {
    asset: Asset;
    toAddress: string;
    amount: bigint;
    /** Idempotency key so a retried withdrawal is never double-sent. */
    idempotencyKey: string;
  }): Promise<SendResult>;
}
