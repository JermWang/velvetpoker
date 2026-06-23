/**
 * In-memory mock Solana provider for development. Lets tests / the deposit
 * monitor simulate incoming transfers and outbound sends deterministically.
 */

import { randomBytes } from "node:crypto";
import type { Asset } from "@prisma/client";
import type {
  IncomingTransfer,
  SendResult,
  SolanaProvider,
} from "./provider";

export class MockSolanaProvider implements SolanaProvider {
  readonly name = "mock";
  private pending = new Map<string, IncomingTransfer[]>();
  private confirmations = new Map<string, number>();

  /** Test helper: queue a simulated incoming deposit. */
  simulateDeposit(t: Omit<IncomingTransfer, "confirmations" | "slot">): void {
    const list = this.pending.get(t.toAddress) ?? [];
    const full: IncomingTransfer = { ...t, confirmations: 64, slot: Date.now() };
    list.push(full);
    this.pending.set(t.toAddress, list);
    this.confirmations.set(t.txSignature, 64);
  }

  async getConfirmations(signature: string): Promise<number> {
    return this.confirmations.get(signature) ?? 0;
  }

  async getOnChainBalance(_address: string, _asset: Asset): Promise<bigint> {
    // The mock holds no real chain balance; treasury reconciliation is gated to
    // the real provider, so this is only ever a placeholder in dev/tests.
    return 0n;
  }

  async getIncomingTransfers(
    address: string,
    _untilSignature?: string,
  ): Promise<IncomingTransfer[]> {
    return this.pending.get(address) ?? [];
  }

  async sendTransfer(params: {
    asset: Asset;
    toAddress: string;
    amount: bigint;
    idempotencyKey: string;
  }): Promise<SendResult> {
    // Deterministic-ish fake signature; in real life this is the chain's sig.
    const sig = `mock_${params.idempotencyKey}_${randomBytes(6).toString(
      "hex",
    )}`;
    this.confirmations.set(sig, 64);
    return { txSignature: sig };
  }

  async postMemo(_memo: string): Promise<SendResult> {
    const sig = `mock_memo_${randomBytes(8).toString("hex")}`;
    this.confirmations.set(sig, 64);
    return { txSignature: sig };
  }
}
