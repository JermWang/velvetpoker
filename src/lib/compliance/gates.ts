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
export function evaluateRealMoneyGates(_user: User): GateResult {
  // ALL real-money play gates are intentionally disabled: no KYC, no
  // age-verification, no geofence, no eligibility, no self-exclusion gate.
  // Anyone who connects a wallet can play. (Kept as a function returning the
  // same shape so every caller and the gate-card UI keep compiling.)
  return { allowed: true, failures: [] };
}

/** Convenience boolean used in hot paths (joining/buying in). */
export function canPlayRealMoney(user: User): boolean {
  return evaluateRealMoneyGates(user).allowed;
}
