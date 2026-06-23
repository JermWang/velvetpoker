/**
 * Ledger service. The ONLY place balances are mutated.
 *
 * Every public function runs inside a single database transaction so that the
 * LedgerEntry rows and the cached Balance rows are always written together,
 * atomically. No code outside this module may touch the Balance table.
 */

import { Prisma } from "@prisma/client";
import type { Asset } from "@prisma/client";
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

  // Ensure the row exists so the row-lock below has something to take. The
  // empty `update` makes a concurrent existing-row upsert a no-op; the real
  // serialization is the SELECT ... FOR UPDATE that follows.
  await db.balance.upsert({
    where: { userId_asset: { userId, asset } },
    create: { userId, asset },
    update: {},
  });

  // PESSIMISTIC LOCK: take an exclusive row lock for the duration of the
  // transaction and read the CURRENT committed balance. Without this, two
  // concurrent debits both read the old balance, both pass the non-negative
  // guard, and both write — a lost update that lets a user overdraft / conjure
  // funds (buy in at two tables at once, double-withdraw, etc.). FOR UPDATE
  // forces the second transaction to block until the first commits, so it sees
  // the already-reduced balance and its guard correctly rejects the overdraft.
  const rows = await db.$queryRaw<
    {
      availableAmount: bigint;
      lockedAmount: bigint;
      referralEarningsAmount: bigint;
    }[]
  >(Prisma.sql`
    SELECT "availableAmount", "lockedAmount", "referralEarningsAmount"
    FROM "Balance"
    WHERE "userId" = ${userId} AND "asset" = ${asset}::"Asset"
    FOR UPDATE
  `);
  const row = rows[0];

  let available = row?.availableAmount ?? 0n;
  let locked = row?.lockedAmount ?? 0n;
  let referralEarnings = row?.referralEarningsAmount ?? 0n;

  if (l.accountType === "USER_AVAILABLE") available += delta;
  else if (l.accountType === "USER_TABLE_LOCKED") locked += delta;
  else if (l.accountType === "USER_REFERRAL_EARNINGS") referralEarnings += delta;

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
  if (referralEarnings < 0n) {
    throw new LedgerError(
      `Insufficient referral earnings for user ${userId} (${asset})`,
    );
  }

  await db.balance.update({
    where: { userId_asset: { userId, asset } },
    data: {
      availableAmount: available,
      lockedAmount: locked,
      referralEarningsAmount: referralEarnings,
    },
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
 * How a hand's rake is split. All amounts are base units and must sum to the
 * total rake taken out of the pot. `referralPayouts` credit each referrer's
 * claimable referral-earnings bucket; `team` + `buyback` go to system revenue
 * accounts. Computed by the settlement layer (see realtime/persistence.ts).
 */
export interface RakeSplit {
  team: bigint;
  buyback: bigint;
  referralPayouts: Array<{ referrerUserId: string; amount: bigint }>;
}

/**
 * Settle a completed hand against table-locked balances. Winners' locked balance
 * rises, losers' falls. Any rake taken out of the pot is split: the players'
 * net deltas already reflect the rake deduction (they sum to -totalRake), and
 * the rake is routed to TEAM_REVENUE, BUYBACK_RESERVE, and referrers' claimable
 * earnings. The full set of legs must balance (enforced by assertBalanced).
 */
export async function settleHandLedger(
  params: {
    asset: Asset;
    tableId: string;
    handId: string;
    correlationId: string;
    deltas: HandSettlementLeg[];
    rakeSplit?: RakeSplit;
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

  const split = params.rakeSplit;
  if (split) {
    if (split.team > 0n) legs.push(leg.system("TEAM_REVENUE", "CREDIT", split.team));
    if (split.buyback > 0n)
      legs.push(leg.system("BUYBACK_RESERVE", "CREDIT", split.buyback));
    for (const p of split.referralPayouts) {
      if (p.amount > 0n)
        legs.push(leg.userReferralEarnings(p.referrerUserId, "CREDIT", p.amount));
    }
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

/**
 * Claim accrued referral earnings into the user's available balance (which can
 * then be withdrawn). Moves the full claimable amount and returns it.
 */
export async function claimReferralEarnings(
  params: { userId: string; asset: Asset; correlationId: string },
  tx?: Tx,
): Promise<bigint> {
  const run = async (db: Tx): Promise<bigint> => {
    const balance = await db.balance.findUnique({
      where: { userId_asset: { userId: params.userId, asset: params.asset } },
    });
    const amount = balance?.referralEarningsAmount ?? 0n;
    if (amount <= 0n) return 0n;

    await postLedgerTransaction(
      {
        asset: params.asset,
        reason: "REFERRAL_CLAIMED",
        correlationId: params.correlationId,
        legs: [
          leg.userReferralEarnings(params.userId, "DEBIT", amount),
          leg.userAvailable(params.userId, "CREDIT", amount),
        ],
      },
      db,
    );
    return amount;
  };

  return tx ? run(tx) : prisma.$transaction(run);
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

/**
 * The amount of `asset` that SHOULD be sitting in the treasury/hot wallet on
 * chain, per the ledger: deposits flowed in (TREASURY_CASH DEBIT) and sent
 * withdrawals flowed out (TREASURY_CASH CREDIT), so expected = debits − credits.
 * Equivalently it equals the sum of every outstanding custodial liability (user
 * balances + pending withdrawals + house revenue) by the double-entry identity.
 */
export async function treasuryExpectedOnChain(asset: Asset): Promise<bigint> {
  const grouped = await prisma.ledgerEntry.groupBy({
    by: ["direction"],
    where: { asset, accountType: "TREASURY_CASH" },
    _sum: { amount: true },
  });
  let debits = 0n;
  let credits = 0n;
  for (const g of grouped) {
    if (g.direction === "DEBIT") debits += g._sum.amount ?? 0n;
    else credits += g._sum.amount ?? 0n;
  }
  return debits - credits;
}

export async function reconcileUserBalance(
  userId: string,
  asset: Asset,
): Promise<{
  ok: boolean;
  cachedAvailable: bigint;
  ledgerAvailable: bigint;
  cachedLocked: bigint;
  ledgerLocked: bigint;
  cachedReferral: bigint;
  ledgerReferral: bigint;
}> {
  const [balance, entries] = await Promise.all([
    prisma.balance.findUnique({ where: { userId_asset: { userId, asset } } }),
    prisma.ledgerEntry.findMany({ where: { userId, asset } }),
  ]);

  let available = 0n;
  let locked = 0n;
  let referral = 0n;
  for (const e of entries) {
    const sign = e.direction === "CREDIT" ? 1n : -1n;
    if (e.accountType === "USER_AVAILABLE") available += sign * e.amount;
    else if (e.accountType === "USER_TABLE_LOCKED") locked += sign * e.amount;
    else if (e.accountType === "USER_REFERRAL_EARNINGS") referral += sign * e.amount;
  }

  const cachedAvailable = balance?.availableAmount ?? 0n;
  const cachedLocked = balance?.lockedAmount ?? 0n;
  const cachedReferral = balance?.referralEarningsAmount ?? 0n;
  return {
    ok:
      cachedAvailable === available &&
      cachedLocked === locked &&
      cachedReferral === referral,
    cachedAvailable,
    ledgerAvailable: available,
    cachedLocked,
    ledgerLocked: locked,
    cachedReferral,
    ledgerReferral: referral,
  };
}

export { LedgerError } from "./entries";
