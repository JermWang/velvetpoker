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
  /**
   * Current on-chain balance of an address for an asset, in base units (lamports
   * for SOL, token base units for SPL). Returns 0 if the token account does not
   * exist. Used to reconcile custodial liabilities against real chain holdings.
   */
  getOnChainBalance(address: string, asset: Asset): Promise<bigint>;
  /**
   * Incoming transfers to a watched address. Pages through ALL signatures newer
   * than `untilSignature` (an RPC-side cursor — the last signature already
   * processed), so no transfer is missed under load. Omit the cursor to scan the
   * most recent page as a baseline.
   */
  getIncomingTransfers(
    address: string,
    untilSignature?: string,
  ): Promise<IncomingTransfer[]>;
  /** Send an outbound transfer from the hot wallet. SERVER ONLY. */
  sendTransfer(params: {
    asset: Asset;
    toAddress: string;
    amount: bigint;
    /** Idempotency key so a retried withdrawal is never double-sent. */
    idempotencyKey: string;
  }): Promise<SendResult>;
  /**
   * Post a memo transaction signed by the hot wallet (used to anchor outcome
   * Merkle roots on-chain). SERVER ONLY.
   */
  postMemo(memo: string): Promise<SendResult>;
}
