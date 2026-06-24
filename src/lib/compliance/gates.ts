/**
 * Compliance gates: the single decision point for whether a user may engage in
 * real-money play. Depends only on persisted user state + the provider
 * interface. Returns structured reasons so the UI can render a ComplianceGate
 * card explaining exactly what is required.
 */

import type { User } from "@prisma/client";
import { MockComplianceProvider } from "./mock-provider";
import type { ComplianceProvider } from "./provider";

/** Resolve the active provider. Swap here for a real vendor in production. */
export function getComplianceProvider(): ComplianceProvider {
  return new MockComplianceProvider();
}

export type GateCode =
  | "ACCOUNT_NOT_ACTIVE"
  | "SELF_EXCLUDED"
  | "RESPONSIBLE_GAMING_BLOCK";

export interface GateFailure {
  code: GateCode;
  message: string;
}

export interface GateResult {
  allowed: boolean;
  failures: GateFailure[];
}

/**
 * Evaluate all real-money play gates against the user's current persisted
 * compliance state. This does NOT call external vendors (that happens on a
 * schedule / on demand and updates the User record); it reads the resolved
 * status so gameplay checks are fast and deterministic.
 */
export function evaluateRealMoneyGates(user: User): GateResult {
  const failures: GateFailure[] = [];
  const now = new Date();

  // Wallet-native, privacy-first play: NO KYC, NO age-verification step, and NO
  // in-app geofence gate (the 18+ acknowledgement lives on the splash page).
  // Play is only ever blocked for a genuinely restricted account.
  if (user.status === "SELF_EXCLUDED") {
    failures.push({
      code: "SELF_EXCLUDED",
      message: "Your account is self-excluded from real-money play.",
    });
  } else if (user.status !== "ACTIVE") {
    failures.push({
      code: "ACCOUNT_NOT_ACTIVE",
      message: `Your account status is ${user.status}.`,
    });
  }

  if (user.selfExcludedUntil && user.selfExcludedUntil > now) {
    failures.push({
      code: "RESPONSIBLE_GAMING_BLOCK",
      message: `A responsible-gaming limit is active until ${user.selfExcludedUntil.toISOString()}.`,
    });
  }

  return { allowed: failures.length === 0, failures };
}

/** Convenience boolean used in hot paths (joining/buying in). */
export function canPlayRealMoney(user: User): boolean {
  return evaluateRealMoneyGates(user).allowed;
}
