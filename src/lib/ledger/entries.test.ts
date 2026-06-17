import { describe, expect, it } from "vitest";
import { assertBalanced, leg, LedgerError } from "./entries";
import type { LedgerTransactionInput } from "./entries";

function tx(legs: LedgerTransactionInput["legs"]): LedgerTransactionInput {
  return {
    asset: "SOL",
    reason: "DEPOSIT_CONFIRMED",
    correlationId: "test",
    legs,
  };
}

describe("double-entry invariant", () => {
  it("accepts a balanced deposit (treasury -> user)", () => {
    expect(() =>
      assertBalanced(
        tx([
          leg.system("TREASURY_CASH", "DEBIT", 5n),
          leg.userAvailable("u1", "CREDIT", 5n),
        ]),
      ),
    ).not.toThrow();
  });

  it("accepts a balanced buy-in (available -> locked)", () => {
    expect(() =>
      assertBalanced(
        tx([
          leg.userAvailable("u1", "DEBIT", 2n),
          leg.userTableLocked("u1", "CREDIT", 2n),
        ]),
      ),
    ).not.toThrow();
  });

  it("accepts a multi-party hand settlement that nets to zero", () => {
    expect(() =>
      assertBalanced(
        tx([
          leg.userTableLocked("winner", "CREDIT", 10n),
          leg.userTableLocked("loserA", "DEBIT", 6n),
          leg.userTableLocked("loserB", "DEBIT", 4n),
        ]),
      ),
    ).not.toThrow();
  });

  it("rejects unbalanced legs (credits != debits)", () => {
    expect(() =>
      assertBalanced(
        tx([
          leg.system("TREASURY_CASH", "DEBIT", 5n),
          leg.userAvailable("u1", "CREDIT", 4n),
        ]),
      ),
    ).toThrow(LedgerError);
  });

  it("rejects a single-leg transaction", () => {
    expect(() =>
      assertBalanced(tx([leg.userAvailable("u1", "CREDIT", 5n)])),
    ).toThrow(LedgerError);
  });

  it("rejects non-positive amounts", () => {
    expect(() =>
      assertBalanced(
        tx([
          leg.system("TREASURY_CASH", "DEBIT", 0n),
          leg.userAvailable("u1", "CREDIT", 0n),
        ]),
      ),
    ).toThrow(LedgerError);
  });

  it("requires a userId on user-balance legs", () => {
    expect(() =>
      assertBalanced(
        tx([
          { accountType: "USER_AVAILABLE", direction: "CREDIT", amount: 5n },
          leg.system("TREASURY_CASH", "DEBIT", 5n),
        ]),
      ),
    ).toThrow(LedgerError);
  });
});
