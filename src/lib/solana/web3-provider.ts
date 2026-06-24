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
  type ConfirmedSignatureInfo,
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
/** Signatures fetched per RPC page (Solana's max is 1000). */
const SIGNATURE_SCAN_LIMIT = 1000;
/** Safety cap on pages per poll (SIGNATURE_SCAN_LIMIT * this = max backlog
 * drained per poll). Hitting it logs a backlog warning. */
const MAX_SCAN_PAGES = 10;
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

  async getOnChainBalance(address: string, asset: Asset): Promise<bigint> {
    const owner = new PublicKey(address);
    if (asset === "SOL") {
      return BigInt(await this.connection.getBalance(owner));
    }
    const mint = this.splMints[asset];
    if (!mint) return 0n;
    const ata = await getAssociatedTokenAddress(mint, owner);
    try {
      const bal = await this.connection.getTokenAccountBalance(ata);
      return BigInt(bal.value.amount);
    } catch {
      // The associated token account doesn't exist yet → zero balance.
      return 0n;
    }
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
    untilSignature?: string,
  ): Promise<IncomingTransfer[]> {
    const owner = new PublicKey(address);

    // Page backwards from the newest signature down to the cursor (`until`), so
    // EVERY signature since the last poll is processed — not just the most recent
    // page. Without this, under load (>1 page of treasury txs between polls) a
    // pending deposit could scroll out of the window before it confirms and be
    // lost. The page cap bounds work per poll; hitting it signals a backlog.
    const sigInfos: ConfirmedSignatureInfo[] = [];
    let before: string | undefined;
    let hitCap = true;
    for (let page = 0; page < MAX_SCAN_PAGES; page++) {
      const batch = await this.connection.getSignaturesForAddress(owner, {
        limit: SIGNATURE_SCAN_LIMIT,
        before,
        until: untilSignature,
      });
      sigInfos.push(...batch);
      if (batch.length < SIGNATURE_SCAN_LIMIT) {
        hitCap = false;
        break;
      }
      before = batch[batch.length - 1]!.signature;
    }
    if (hitCap) {
      console.warn(
        `[solana] deposit scan for ${address} hit the ${MAX_SCAN_PAGES}-page cap — possible backlog, will continue next poll`,
      );
    }

    const transfers: IncomingTransfer[] = [];
    for (const info of sigInfos) {
      if (info.err) continue;

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
        const preB = tx.meta.preBalances;
        const postB = tx.meta.postBalances;
        const delta = BigInt(postB[idx] ?? 0) - BigInt(preB[idx] ?? 0);
        if (delta > 0n) {
          // Attribute to the VALUE SOURCE — the account that paid the most out,
          // which matches the deposit — NOT the fee payer (accountKeys[0]). For
          // exchange withdrawals / relayers the fee payer is not the user's
          // wallet, so fee-payer attribution silently drops those deposits.
          let senderIdx = -1;
          let maxOut = 0n;
          for (let j = 0; j < keys.length; j++) {
            if (j === idx) continue;
            const out = BigInt(preB[j] ?? 0) - BigInt(postB[j] ?? 0);
            if (out > maxOut) {
              maxOut = out;
              senderIdx = j;
            }
          }
          transfers.push({
            txSignature: info.signature,
            toAddress: address,
            fromAddress: senderIdx >= 0 ? keys[senderIdx]! : keys[0] ?? null,
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
          // Source = the token account of the same mint whose balance dropped;
          // its `owner` is the sender's wallet. Falls back to the fee payer only
          // when no source can be identified (e.g. the source account closed).
          let sourceOwner: string | null = null;
          let maxDrop = 0n;
          for (const s of post) {
            if (s.mint !== p.mint || s.owner === address) continue;
            const sBefore = pre.find((x) => x.accountIndex === s.accountIndex);
            const drop =
              BigInt(sBefore?.uiTokenAmount.amount ?? "0") -
              BigInt(s.uiTokenAmount.amount ?? "0");
            if (drop > maxDrop) {
              maxDrop = drop;
              sourceOwner = s.owner ?? null;
            }
          }
          transfers.push({
            txSignature: info.signature,
            toAddress: address,
            fromAddress: sourceOwner ?? keys[0] ?? null,
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
      // The withdrawer pays their own network fee: deduct it from the amount sent
      // so the treasury's total on-chain outflow equals exactly the requested
      // amount. No operator gas subsidy, and no SOL buffer beyond user balances
      // is required for SOL cash-outs (treasury asset down == user liability down).
      const { blockhash } = await this.connection.getLatestBlockhash();
      const probe = new Transaction({
        feePayer: this.hotWallet.publicKey,
        recentBlockhash: blockhash,
      }).add(
        SystemProgram.transfer({
          fromPubkey: this.hotWallet.publicKey,
          toPubkey: to,
          lamports: params.amount,
        }),
      );
      const feeResp = await this.connection.getFeeForMessage(probe.compileMessage());
      const fee = BigInt(feeResp.value ?? 5000);
      const sendLamports = params.amount - fee;
      if (sendLamports <= 0n) {
        throw new Error(
          `Withdrawal amount (${params.amount} lamports) is too small to cover the network fee (${fee} lamports)`,
        );
      }
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: this.hotWallet.publicKey,
          toPubkey: to,
          lamports: sendLamports,
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
