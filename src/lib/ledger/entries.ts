/**
 * Ledger leg builders and the double-entry invariant.
 *
 * A ledger "transaction" is a set of legs that MUST balance: for each asset the
 * sum of CREDIT amounts equals the sum of DEBIT amounts. This guarantees money
 * is conserved — it can only move between accounts, never appear or vanish.
 */

import type {
  Asset,
  LedgerAccountType,
  LedgerDirection,
} from "@prisma/client";

export interface LedgerLeg {
  /** Required for USER_AVAILABLE / USER_TABLE_LOCKED legs (cached balances). */
  userId?: string | null;
  accountType: LedgerAccountType;
  direction: LedgerDirection;
  amount: bigint;
}

export interface LedgerTransactionInput {
  asset: Asset;
  reason: import("@prisma/client").LedgerReason;
  correlationId: string;
  tableId?: string | null;
  handId?: string | null;
  metadata?: Record<string, unknown>;
  legs: LedgerLeg[];
}

/** User-facing accounts whose cached Balance rows we keep in sync. */
const USER_BALANCE_ACCOUNTS: LedgerAccountType[] = [
  "USER_AVAILABLE",
  "USER_TABLE_LOCKED",
  "USER_REFERRAL_EARNINGS",
];

export function isUserBalanceAccount(a: LedgerAccountType): boolean {
  return USER_BALANCE_ACCOUNTS.includes(a);
}

/** Throws if the legs do not balance (credits !== debits) or are malformed. */
export function assertBalanced(input: LedgerTransactionInput): void {
  if (input.legs.length < 2) {
    throw new LedgerError("A ledger transaction needs at least two legs");
  }
  let credits = 0n;
  let debits = 0n;
  for (const leg of input.legs) {
    if (leg.amount <= 0n) {
      throw new LedgerError("Ledger leg amounts must be positive");
    }
    if (isUserBalanceAccount(leg.accountType) && !leg.userId) {
      throw new LedgerError(
        `Leg for ${leg.accountType} requires a userId`,
      );
    }
    if (leg.direction === "CREDIT") credits += leg.amount;
    else debits += leg.amount;
  }
  if (credits !== debits) {
    throw new LedgerError(
      `Unbalanced ledger transaction: credits=${credits} debits=${debits}`,
    );
  }
}

export class LedgerError extends Error {}

// Common leg constructors -----------------------------------------------------

export const leg = {
  userAvailable(
    userId: string,
    direction: LedgerDirection,
    amount: bigint,
  ): LedgerLeg {
    return { userId, accountType: "USER_AVAILABLE", direction, amount };
  },
  userTableLocked(
    userId: string,
    direction: LedgerDirection,
    amount: bigint,
  ): LedgerLeg {
    return { userId, accountType: "USER_TABLE_LOCKED", direction, amount };
  },
  userReferralEarnings(
    userId: string,
    direction: LedgerDirection,
    amount: bigint,
  ): LedgerLeg {
    return { userId, accountType: "USER_REFERRAL_EARNINGS", direction, amount };
  },
  system(
    accountType: LedgerAccountType,
    direction: LedgerDirection,
    amount: bigint,
  ): LedgerLeg {
    return { accountType, direction, amount };
  },
};
