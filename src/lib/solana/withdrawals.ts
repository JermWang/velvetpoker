/**
 * Withdrawal service.
 *
 * Lifecycle: REQUESTED -> (auto APPROVED | PENDING_REVIEW) -> SENT | REJECTED.
 *  - Funds are locked out of available balance the moment a request is made.
 *  - Small, low-risk withdrawals may auto-approve; large ones require an admin.
 *  - Sending uses the chain provider; the signature is persisted.
 *  - Any failure path unlocks the balance safely (refund to available).
 */

import type { Asset } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/env";
import {
  lockWithdrawal,
  refundWithdrawal,
  settleWithdrawalSent,
  LedgerError,
} from "@/lib/ledger/ledger";
import { recordRiskEvent } from "@/lib/risk/risk-events";
import { getSolanaProvider } from "./connection";

export interface RequestWithdrawalResult {
  withdrawalId: string;
  status: "PENDING_REVIEW" | "APPROVED";
  requiresReview: boolean;
}

/**
 * Create a withdrawal request and lock the funds. Decides review-vs-auto based
 * on amount threshold (SOL lamports basis; USDC uses an equivalent threshold).
 */
export async function requestWithdrawal(params: {
  userId: string;
  asset: Asset;
  amount: bigint;
  toAddress: string;
}): Promise<RequestWithdrawalResult> {
  if (params.amount <= 0n) throw new Error("Amount must be positive");

  return prisma.$transaction(async (tx) => {
    // Double-submit / idempotency guard: refuse a second identical request
    // while one is still in flight (not yet sent, rejected, or failed).
    const inflightDuplicate = await tx.withdrawal.findFirst({
      where: {
        userId: params.userId,
        asset: params.asset,
        amount: params.amount,
        toAddress: params.toAddress,
        status: { in: ["REQUESTED", "PENDING_REVIEW", "APPROVED"] },
      },
    });
    if (inflightDuplicate) {
      throw new Error("An identical withdrawal is already in progress");
    }

    // Velocity: count + per-asset amount over a rolling window. Exceeding
    // either forces manual review rather than blocking the user.
    const since = new Date(Date.now() - VELOCITY_WINDOW_MS);
    const recent = await tx.withdrawal.findMany({
      where: {
        userId: params.userId,
        createdAt: { gte: since },
        status: { notIn: ["REJECTED", "FAILED"] },
      },
      select: { asset: true, amount: true },
    });
    const recentAssetTotal =
      recent
        .filter((w) => w.asset === params.asset)
        .reduce((sum, w) => sum + w.amount, 0n) + params.amount;
    const overVelocity =
      recent.length >= env.withdrawalDailyMaxCount ||
      recentAssetTotal > velocityAmountCap(params.asset);

    const requiresReview =
      aboveReviewThreshold(params.asset, params.amount) || overVelocity;

    // Lock funds; throws if insufficient available balance.
    await lockWithdrawal(
      {
        userId: params.userId,
        asset: params.asset,
        amount: params.amount,
        correlationId: `withdrawal-request:${params.userId}:${Date.now()}`,
      },
      tx,
    );

    const withdrawal = await tx.withdrawal.create({
      data: {
        userId: params.userId,
        asset: params.asset,
        amount: params.amount,
        toAddress: params.toAddress,
        status: requiresReview ? "PENDING_REVIEW" : "APPROVED",
      },
    });

    if (requiresReview) {
      await recordRiskEvent(
        {
          userId: params.userId,
          type: "WITHDRAWAL_REVIEW",
          severity: overVelocity ? "HIGH" : "MEDIUM",
          metadata: {
            kind: overVelocity ? "velocity" : "amount_threshold",
            withdrawalId: withdrawal.id,
            amount: params.amount.toString(),
            asset: params.asset,
            recentCount: recent.length,
            recentAssetTotal: recentAssetTotal.toString(),
          },
        },
        tx,
      );
    }

    return {
      withdrawalId: withdrawal.id,
      status: withdrawal.status as "PENDING_REVIEW" | "APPROVED",
      requiresReview,
    };
  });
}

/** Send an APPROVED withdrawal on-chain and mark it SENT. */
export async function sendApprovedWithdrawal(
  withdrawalId: string,
): Promise<{ txSignature: string }> {
  const withdrawal = await prisma.withdrawal.findUnique({
    where: { id: withdrawalId },
  });
  if (!withdrawal) throw new Error("Withdrawal not found");
  if (withdrawal.status !== "APPROVED") {
    throw new Error(`Withdrawal is not APPROVED (is ${withdrawal.status})`);
  }

  const provider = getSolanaProvider();
  let txSignature: string;
  try {
    const res = await provider.sendTransfer({
      asset: withdrawal.asset,
      toAddress: withdrawal.toAddress,
      amount: withdrawal.amount,
      idempotencyKey: withdrawal.id,
    });
    txSignature = res.txSignature;
  } catch (err) {
    await failWithdrawal(withdrawalId, String(err));
    throw err;
  }

  await prisma.$transaction(async (tx) => {
    await settleWithdrawalSent(
      {
        userId: withdrawal.userId,
        asset: withdrawal.asset,
        amount: withdrawal.amount,
        correlationId: `withdrawal-sent:${withdrawal.id}`,
        metadata: { txSignature },
      },
      tx,
    );
    await tx.withdrawal.update({
      where: { id: withdrawal.id },
      data: { status: "SENT", txSignature },
    });
  });

  return { txSignature };
}

/** Reject a withdrawal under review and unlock the funds back to available. */
export async function rejectWithdrawal(params: {
  withdrawalId: string;
  reviewerUserId: string;
  note?: string;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const w = await tx.withdrawal.findUnique({
      where: { id: params.withdrawalId },
    });
    if (!w) throw new Error("Withdrawal not found");
    if (w.status === "SENT") throw new Error("Cannot reject a sent withdrawal");

    await refundWithdrawal(
      {
        userId: w.userId,
        asset: w.asset,
        amount: w.amount,
        correlationId: `withdrawal-reject:${w.id}`,
      },
      tx,
    );
    await tx.withdrawal.update({
      where: { id: w.id },
      data: {
        status: "REJECTED",
        reviewedBy: params.reviewerUserId,
        reviewNote: params.note,
      },
    });
  });
}

/** Admin approves a PENDING_REVIEW withdrawal (does not send yet). */
export async function approveWithdrawal(params: {
  withdrawalId: string;
  reviewerUserId: string;
  note?: string;
}): Promise<void> {
  await prisma.withdrawal.update({
    where: { id: params.withdrawalId },
    data: {
      status: "APPROVED",
      reviewedBy: params.reviewerUserId,
      reviewNote: params.note,
    },
  });
}

async function failWithdrawal(withdrawalId: string, note: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const w = await tx.withdrawal.findUnique({ where: { id: withdrawalId } });
    if (!w) return;
    // Only refund if funds are still locked (not already SENT).
    if (w.status !== "SENT") {
      try {
        await refundWithdrawal(
          {
            userId: w.userId,
            asset: w.asset,
            amount: w.amount,
            correlationId: `withdrawal-fail:${w.id}`,
          },
          tx,
        );
      } catch (e) {
        // If refund itself fails (e.g. already refunded), swallow; the ledger
        // remains the source of truth and reconciliation will flag mismatches.
        if (!(e instanceof LedgerError)) throw e;
      }
    }
    await tx.withdrawal.update({
      where: { id: w.id },
      data: { status: "FAILED", reviewNote: note.slice(0, 480) },
    });
  });
}

/** Rolling window for per-user withdrawal velocity. */
const VELOCITY_WINDOW_MS = 24 * 60 * 60 * 1000;

function velocityAmountCap(asset: Asset): bigint {
  return asset === "SOL"
    ? env.withdrawalDailyMaxLamports
    : env.withdrawalDailyMaxUsdc;
}

function aboveReviewThreshold(asset: Asset, amount: bigint): boolean {
  if (asset === "SOL") return amount >= env.minWithdrawalReviewLamports;
  // USDC threshold: treat the same numeric magnitude scaled to 6 decimals as a
  // reasonable default (e.g. >= 1000 USDC). Configurable later.
  return amount >= 1_000_000_000n; // 1000 USDC in base units
}
