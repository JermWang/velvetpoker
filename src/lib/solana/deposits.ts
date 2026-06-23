/**
 * Deposit service. Users deposit from their connected Solana wallet to the
 * shared treasury address; the monitor attributes each incoming transfer to the
 * user by matching the SENDER address to their linked wallet, waits for
 * confirmations, and credits the internal ledger exactly once per tx signature
 * (idempotent). Funds land directly in the treasury — no per-user deposit
 * addresses, no key custody, no sweeping.
 */

import type { Asset } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/env";
import { creditDeposit } from "@/lib/ledger/ledger";
import { getSolanaProvider } from "./connection";

/**
 * Process a single observed transfer. Idempotent on txSignature: if a Deposit
 * row already exists for this signature it is updated, never duplicated, and
 * crediting happens at most once.
 */
export async function ingestTransfer(params: {
  userId: string;
  asset: Asset;
  toAddress: string;
  fromAddress: string | null;
  txSignature: string;
  amount: bigint;
  confirmations: number;
}): Promise<{ credited: boolean }> {
  const confirmed = params.confirmations >= env.depositConfirmations;

  return prisma.$transaction(async (tx) => {
    const existing = await tx.deposit.findUnique({
      where: { txSignature: params.txSignature },
    });

    // Already credited — nothing to do (idempotent guard).
    if (existing?.status === "CREDITED") {
      return { credited: false };
    }

    const deposit = existing
      ? await tx.deposit.update({
          where: { txSignature: params.txSignature },
          data: {
            confirmations: params.confirmations,
            status: confirmed ? "CONFIRMED" : "DETECTED",
          },
        })
      : await tx.deposit.create({
          data: {
            userId: params.userId,
            asset: params.asset,
            chain: "SOLANA",
            fromAddress: params.fromAddress,
            toAddress: params.toAddress,
            txSignature: params.txSignature,
            amount: params.amount,
            confirmations: params.confirmations,
            status: confirmed ? "CONFIRMED" : "DETECTED",
          },
        });

    if (!confirmed) return { credited: false };

    // Credit the ledger and flip to CREDITED within the same transaction.
    await creditDeposit(
      {
        userId: deposit.userId,
        asset: deposit.asset,
        amount: deposit.amount,
        correlationId: `deposit:${deposit.txSignature}`,
        metadata: { txSignature: deposit.txSignature },
      },
      tx,
    );

    await tx.deposit.update({
      where: { id: deposit.id },
      data: { status: "CREDITED", creditedAt: new Date() },
    });

    return { credited: true };
  });
}

/**
 * Re-check every recorded-but-uncredited deposit by its signature and credit it
 * once it reaches the confirmation threshold. This is INDEPENDENT of the treasury
 * scan window: once a deposit has been recorded (status DETECTED/CONFIRMED), it is
 * polled directly by signature until credited, so a deposit can never be lost just
 * because its signature scrolled out of the recent-signatures scan under load.
 */
export async function recheckPendingDeposits(): Promise<{ credited: number }> {
  const provider = getSolanaProvider();
  const pending = await prisma.deposit.findMany({
    where: { chain: "SOLANA", status: { in: ["DETECTED", "CONFIRMED"] } },
  });

  let credited = 0;
  for (const d of pending) {
    const confirmations = await provider.getConfirmations(d.txSignature);
    if (confirmations <= 0) continue;
    const res = await ingestTransfer({
      userId: d.userId,
      asset: d.asset,
      toAddress: d.toAddress,
      fromAddress: d.fromAddress,
      txSignature: d.txSignature,
      amount: d.amount,
      confirmations,
    });
    if (res.credited) credited++;
  }
  return { credited };
}

/**
 * Scan the treasury address for incoming transfers and credit each to the user
 * whose linked wallet sent it. Transfers from unknown wallets are skipped (left
 * for manual review). Used by the deposit-monitor job and on-demand.
 *
 * Uses the most recently recorded deposit as an RPC-side cursor so only NEW
 * signatures are fetched/parsed each poll, and always re-checks already-recorded
 * pending deposits so none are lost to the scan window.
 */
export async function scanTreasuryDeposits(): Promise<{ credited: number; unattributed: number }> {
  const treasury = env.treasuryWalletAddress;
  if (!treasury) return { credited: 0, unattributed: 0 };

  const provider = getSolanaProvider();

  // Cursor: the newest deposit we've already recorded for this treasury. The
  // provider pages back only to here, so we never re-parse the whole history and
  // never miss a signature newer than it.
  const newest = await prisma.deposit.findFirst({
    where: { chain: "SOLANA", toAddress: treasury },
    orderBy: { createdAt: "desc" },
    select: { txSignature: true },
  });

  const transfers = await provider.getIncomingTransfers(
    treasury,
    newest?.txSignature,
  );
  let credited = 0;
  let unattributed = 0;

  for (const t of transfers) {
    if (!t.fromAddress) {
      unattributed++;
      continue;
    }
    const wallet = await prisma.wallet.findUnique({
      where: { chain_address: { chain: "SOLANA", address: t.fromAddress } },
    });
    if (!wallet?.userId) {
      unattributed++;
      continue;
    }
    const res = await ingestTransfer({
      userId: wallet.userId,
      asset: t.asset,
      toAddress: t.toAddress,
      fromAddress: t.fromAddress,
      txSignature: t.txSignature,
      amount: t.amount,
      confirmations: t.confirmations,
    });
    if (res.credited) credited++;
  }

  // Independently advance any recorded-but-uncredited deposits toward CREDITED.
  const recheck = await recheckPendingDeposits();
  credited += recheck.credited;

  return { credited, unattributed };
}
