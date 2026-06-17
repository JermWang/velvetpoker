/**
 * Ledger service. The ONLY place balances are mutated.
 *
 * Every public function runs inside a single database transaction so that the
 * LedgerEntry rows and the cached Balance rows are always written together,
 * atomically. No code outside this module may touch the Balance table.
 */

import type { Asset, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  assertBalanced,
  isUserBalanceAccount,
  leg,
  LedgerError,
  type LedgerLeg,
  type LedgerTransactionInput,
} from "./entries";

type Tx = Prisma.TransactionClient;

/**
 * Core primitive: atomically post a balanced set of legs and reconcile the
 * affected user balance caches. Pass an existing `tx` to compose with a larger
 * transaction (e.g. crediting a deposit + updating the Deposit row together).
 */
export async function postLedgerTransaction(
  input: LedgerTransactionInput,
  tx?: Tx,
): Promise<void> {
  assertBalanced(input);

  const run = async (db: Tx) => {
    for (const l of input.legs) {
      await db.ledgerEntry.create({
        data: {
          userId: l.userId ?? null,
          tableId: input.tableId ?? null,
          handId: input.handId ?? null,
          asset: input.asset,
          amount: l.amount,
          direction: l.direction,
          accountType: l.accountType,
          reason: input.reason,
          correlationId: input.correlationId,
          metadata: input.metadata as Prisma.InputJsonValue | undefined,
        },
      });

      if (isUserBalanceAccount(l.accountType) && l.userId) {
        await applyBalanceDelta(db, l.userId, input.asset, l);
      }
    }
  };

  if (tx) {
    await run(tx);
  } else {
    await prisma.$transaction(run);
  }
}

/** Apply a single leg's effect to the cached Balance row, never going negative. */
async function applyBalanceDelta(
  db: Tx,
  userId: string,
  asset: Asset,
  l: LedgerLeg,
): Promise<void> {
  const sign = l.direction === "CREDIT" ? 1n : -1n;
  const delta = sign * l.amount;

  const balance = await db.balance.upsert({
    where: { userId_asset: { userId, asset } },
    create: { userId, asset },
    update: {},
  });

  let available = balance.availableAmount;
  let locked = balance.lockedAmount;

  if (l.accountType === "USER_AVAILABLE") available += delta;
  else if (l.accountType === "USER_TABLE_LOCKED") locked += delta;

  if (available < 0n) {
    throw new LedgerError(
      `Insufficient available balance for user ${userId} (${asset})`,
    );
  }
  if (locked < 0n) {
    throw new LedgerError(
      `Insufficient locked balance for user ${userId} (${asset})`,
    );
  }

  await db.balance.update({
    where: { userId_asset: { userId, asset } },
    data: { availableAmount: available, lockedAmount: locked },
  });
}

// ---------------------------------------------------------------------------
// High-level money movements
// ---------------------------------------------------------------------------

/** Deposit confirmed on-chain: treasury -> user available. */
export async function creditDeposit(
  params: {
    userId: string;
    asset: Asset;
    amount: bigint;
    correlationId: string;
    metadata?: Record<string, unknown>;
  },
  tx?: Tx,
): Promise<void> {
  await postLedgerTransaction(
    {
      asset: params.asset,
      reason: "DEPOSIT_CONFIRMED",
      correlationId: params.correlationId,
      metadata: params.metadata,
      legs: [
        leg.system("TREASURY_CASH", "DEBIT", params.amount),
        leg.userAvailable(params.userId, "CREDIT", params.amount),
      ],
    },
    tx,
  );
}

/** Seat buy-in: user available -> user table-locked. */
export async function lockBuyIn(
  params: {
    userId: string;
    asset: Asset;
    amount: bigint;
    tableId: string;
    correlationId: string;
  },
  tx?: Tx,
): Promise<void> {
  await postLedgerTransaction(
    {
      asset: params.asset,
      reason: "TABLE_BUY_IN",
      correlationId: params.correlationId,
      tableId: params.tableId,
      legs: [
        leg.userAvailable(params.userId, "DEBIT", params.amount),
        leg.userTableLocked(params.userId, "CREDIT", params.amount),
      ],
    },
    tx,
  );
}

/** Leaving a table: user table-locked -> user available for the final stack. */
export async function cashOutSeat(
  params: {
    userId: string;
    asset: Asset;
    amount: bigint;
    tableId: string;
    correlationId: string;
  },
  tx?: Tx,
): Promise<void> {
  if (params.amount === 0n) return;
  await postLedgerTransaction(
    {
      asset: params.asset,
      reason: "TABLE_CASH_OUT",
      correlationId: params.correlationId,
      tableId: params.tableId,
      legs: [
        leg.userTableLocked(params.userId, "DEBIT", params.amount),
        leg.userAvailable(params.userId, "CREDIT", params.amount),
      ],
    },
    tx,
  );
}

export interface HandSettlementLeg {
  userId: string;
  /** Net change to the player's locked table stack for the hand (may be < 0). */
  net: bigint;
}

/**
 * Settle a completed hand against table-locked balances. Winners' locked
 * balance rises, losers' falls, and any rake routes to PLATFORM_REVENUE. The
 * legs must net to zero across users + rake (enforced by assertBalanced).
 */
export async function settleHandLedger(
  params: {
    asset: Asset;
    tableId: string;
    handId: string;
    correlationId: string;
    deltas: HandSettlementLeg[];
    rake?: bigint;
  },
  tx?: Tx,
): Promise<void> {
  const legs: LedgerLeg[] = [];
  for (const d of params.deltas) {
    if (d.net === 0n) continue;
    legs.push(
      leg.userTableLocked(
        d.userId,
        d.net > 0n ? "CREDIT" : "DEBIT",
        d.net > 0n ? d.net : -d.net,
      ),
    );
  }
  if (params.rake && params.rake > 0n) {
    legs.push(leg.system("PLATFORM_REVENUE", "CREDIT", params.rake));
  }
  if (legs.length === 0) return;

  await postLedgerTransaction(
    {
      asset: params.asset,
      reason: "POT_AWARDED",
      correlationId: params.correlationId,
      tableId: params.tableId,
      handId: params.handId,
      legs,
    },
    tx,
  );
}

/** Withdrawal requested: user available -> withdrawal pending (locked out). */
export async function lockWithdrawal(
  params: {
    userId: string;
    asset: Asset;
    amount: bigint;
    correlationId: string;
  },
  tx?: Tx,
): Promise<void> {
  await postLedgerTransaction(
    {
      asset: params.asset,
      reason: "WITHDRAWAL_REQUESTED",
      correlationId: params.correlationId,
      legs: [
        leg.userAvailable(params.userId, "DEBIT", params.amount),
        leg.system("WITHDRAWAL_PENDING", "CREDIT", params.amount),
      ],
    },
    tx,
  );
}

/** Withdrawal sent on-chain: pending -> treasury out. */
export async function settleWithdrawalSent(
  params: {
    userId: string;
    asset: Asset;
    amount: bigint;
    correlationId: string;
    metadata?: Record<string, unknown>;
  },
  tx?: Tx,
): Promise<void> {
  await postLedgerTransaction(
    {
      asset: params.asset,
      reason: "WITHDRAWAL_SENT",
      correlationId: params.correlationId,
      metadata: params.metadata,
      legs: [
        leg.system("WITHDRAWAL_PENDING", "DEBIT", params.amount),
        leg.system("TREASURY_CASH", "CREDIT", params.amount),
      ],
    },
    tx,
  );
}

/** Withdrawal rejected/failed: pending -> back to user available. */
export async function refundWithdrawal(
  params: {
    userId: string;
    asset: Asset;
    amount: bigint;
    correlationId: string;
  },
  tx?: Tx,
): Promise<void> {
  await postLedgerTransaction(
    {
      asset: params.asset,
      reason: "WITHDRAWAL_REJECTED",
      correlationId: params.correlationId,
      legs: [
        leg.system("WITHDRAWAL_PENDING", "DEBIT", params.amount),
        leg.userAvailable(params.userId, "CREDIT", params.amount),
      ],
    },
    tx,
  );
}

/** Admin manual adjustment, always audit-logged by the caller. */
export async function adminAdjust(
  params: {
    userId: string;
    asset: Asset;
    amount: bigint;
    direction: "CREDIT" | "DEBIT";
    correlationId: string;
    metadata?: Record<string, unknown>;
  },
  tx?: Tx,
): Promise<void> {
  const userLeg = leg.userAvailable(
    params.userId,
    params.direction,
    params.amount,
  );
  const balancing = leg.system(
    "ADJUSTMENT",
    params.direction === "CREDIT" ? "DEBIT" : "CREDIT",
    params.amount,
  );
  await postLedgerTransaction(
    {
      asset: params.asset,
      reason: "ADMIN_ADJUSTMENT",
      correlationId: params.correlationId,
      metadata: params.metadata,
      legs: [userLeg, balancing],
    },
    tx,
  );
}

// ---------------------------------------------------------------------------
// Reconciliation: cached Balance must equal the ledger projection.
// ---------------------------------------------------------------------------

export async function reconcileUserBalance(
  userId: string,
  asset: Asset,
): Promise<{ ok: boolean; cachedAvailable: bigint; ledgerAvailable: bigint; cachedLocked: bigint; ledgerLocked: bigint }> {
  const [balance, entries] = await Promise.all([
    prisma.balance.findUnique({ where: { userId_asset: { userId, asset } } }),
    prisma.ledgerEntry.findMany({ where: { userId, asset } }),
  ]);

  let available = 0n;
  let locked = 0n;
  for (const e of entries) {
    const sign = e.direction === "CREDIT" ? 1n : -1n;
    if (e.accountType === "USER_AVAILABLE") available += sign * e.amount;
    else if (e.accountType === "USER_TABLE_LOCKED") locked += sign * e.amount;
  }

  const cachedAvailable = balance?.availableAmount ?? 0n;
  const cachedLocked = balance?.lockedAmount ?? 0n;
  return {
    ok: cachedAvailable === available && cachedLocked === locked,
    cachedAvailable,
    ledgerAvailable: available,
    cachedLocked,
    ledgerLocked: locked,
  };
}

export { LedgerError } from "./entries";
