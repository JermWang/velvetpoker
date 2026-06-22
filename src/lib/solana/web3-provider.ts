/**
 * Production Solana provider backed by @solana/web3.js + SPL token.
 *
 * Implements deposit detection (SOL + USDC) and outbound transfers from the hot
 * wallet. This is the real chain integration that replaces the mock when a hot
 * wallet + RPC are configured.
 *
 * SECURITY: this signs with a raw secret key read from the environment. That is
 * acceptable for devnet / small floats, but production must move signing behind
 * a KMS/HSM or MPC signer and add velocity limits + allow-listing. See
 * PRODUCTION_TODO.md. Private keys never leave the server.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createTransferInstruction,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import bs58 from "bs58";
import type { Asset } from "@prisma/client";
import { env } from "@/lib/env";
import type {
  IncomingTransfer,
  SendResult,
  SolanaProvider,
} from "./provider";

/** Confirmation count we report for finalized transactions. */
const FINALIZED = 1_000_000;
/** How many recent signatures to scan per address per poll. */
const SIGNATURE_SCAN_LIMIT = 40;
/** SPL Memo program (v2). */
const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
);

export class Web3SolanaProvider implements SolanaProvider {
  readonly name = "web3";
  private connection: Connection;
  /** SPL mints we watch/transfer, keyed by asset. SOL is native (no mint). */
  private splMints: Partial<Record<Asset, PublicKey>>;
  /** Reverse lookup: mint base58 -> asset, for deposit detection. */
  private assetByMint: Map<string, Asset>;
  private hotWallet: Keypair | null;

  constructor(connection: Connection) {
    this.connection = connection;
    this.splMints = { USDC: new PublicKey(env.usdcMint) };
    // The custom token is optional until its mint is configured.
    if (env.tokenMint) {
      this.splMints.TOKEN = new PublicKey(env.tokenMint);
    }
    this.assetByMint = new Map(
      Object.entries(this.splMints).map(([asset, mint]) => [
        mint.toBase58(),
        asset as Asset,
      ]),
    );
    this.hotWallet = loadHotWallet();
  }

  async getConfirmations(signature: string): Promise<number> {
    const res = await this.connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const status = res.value[0];
    if (!status) return 0;
    if (status.err) return 0;
    if (status.confirmationStatus === "finalized") return FINALIZED;
    return status.confirmations ?? 0;
  }

  async getIncomingTransfers(
    address: string,
    sinceSlot?: number,
  ): Promise<IncomingTransfer[]> {
    const owner = new PublicKey(address);
    const sigInfos = await this.connection.getSignaturesForAddress(owner, {
      limit: SIGNATURE_SCAN_LIMIT,
    });

    const transfers: IncomingTransfer[] = [];
    for (const info of sigInfos) {
      if (info.err) continue;
      if (sinceSlot && info.slot <= sinceSlot) continue;

      const tx = await this.connection.getParsedTransaction(info.signature, {
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      });
      if (!tx || !tx.meta) continue;

      const confirmations =
        info.confirmationStatus === "finalized"
          ? FINALIZED
          : await this.getConfirmations(info.signature);

      // --- Native SOL: positive lamport delta on the watched account ---
      const keys = tx.transaction.message.accountKeys.map((k) =>
        k.pubkey.toBase58(),
      );
      const idx = keys.indexOf(address);
      if (idx >= 0 && tx.meta.preBalances && tx.meta.postBalances) {
        const delta =
          BigInt(tx.meta.postBalances[idx] ?? 0) -
          BigInt(tx.meta.preBalances[idx] ?? 0);
        if (delta > 0n) {
          transfers.push({
            txSignature: info.signature,
            toAddress: address,
            fromAddress: keys[0] ?? null,
            asset: "SOL",
            amount: delta,
            confirmations,
            slot: info.slot,
          });
        }
      }

      // --- SPL tokens (USDC + custom TOKEN): positive token-balance delta for
      //     owner, matched to the asset by mint ---
      const pre = tx.meta.preTokenBalances ?? [];
      const post = tx.meta.postTokenBalances ?? [];
      for (const p of post) {
        if (p.owner !== address) continue;
        const asset = this.assetByMint.get(p.mint);
        if (!asset) continue;
        const before = pre.find((x) => x.accountIndex === p.accountIndex);
        const beforeAmt = BigInt(before?.uiTokenAmount.amount ?? "0");
        const afterAmt = BigInt(p.uiTokenAmount.amount ?? "0");
        const delta = afterAmt - beforeAmt;
        if (delta > 0n) {
          transfers.push({
            txSignature: info.signature,
            toAddress: address,
            fromAddress: keys[0] ?? null,
            asset,
            amount: delta,
            confirmations,
            slot: info.slot,
          });
        }
      }
    }
    return transfers;
  }

  async sendTransfer(params: {
    asset: Asset;
    toAddress: string;
    amount: bigint;
    idempotencyKey: string;
  }): Promise<SendResult> {
    if (!this.hotWallet) {
      throw new Error("Hot wallet is not configured (HOT_WALLET_PRIVATE_KEY)");
    }
    const to = new PublicKey(params.toAddress);

    if (params.asset === "SOL") {
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: this.hotWallet.publicKey,
          toPubkey: to,
          lamports: params.amount,
        }),
      );
      const sig = await sendAndConfirmTransaction(this.connection, tx, [
        this.hotWallet,
      ]);
      return { txSignature: sig };
    }

    // SPL transfer (USDC or the custom TOKEN).
    const mint = this.splMints[params.asset];
    if (!mint) {
      throw new Error(`No SPL mint configured for asset ${params.asset}`);
    }
    const fromAta = await getAssociatedTokenAddress(
      mint,
      this.hotWallet.publicKey,
    );
    const toAta = await getOrCreateAssociatedTokenAccount(
      this.connection,
      this.hotWallet,
      mint,
      to,
    );
    const tx = new Transaction().add(
      createTransferInstruction(
        fromAta,
        toAta.address,
        this.hotWallet.publicKey,
        params.amount,
        [],
        TOKEN_PROGRAM_ID,
      ),
    );
    const sig = await sendAndConfirmTransaction(this.connection, tx, [
      this.hotWallet,
    ]);
    return { txSignature: sig };
  }

  async postMemo(memo: string): Promise<SendResult> {
    if (!this.hotWallet) {
      throw new Error("Hot wallet is not configured (HOT_WALLET_PRIVATE_KEY)");
    }
    const ix = new TransactionInstruction({
      keys: [
        {
          pubkey: this.hotWallet.publicKey,
          isSigner: true,
          isWritable: false,
        },
      ],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(memo, "utf8"),
    });
    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(this.connection, tx, [
      this.hotWallet,
    ]);
    return { txSignature: sig };
  }
}

function loadHotWallet(): Keypair | null {
  const key = env.hotWalletPrivateKey;
  if (!key) return null;
  try {
    // Accept base58 (Phantom export) or a JSON byte array.
    if (key.trim().startsWith("[")) {
      return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(key)));
    }
    return Keypair.fromSecretKey(bs58.decode(key));
  } catch (err) {
    console.error("[solana] failed to load hot wallet key", err);
    return null;
  }
}
