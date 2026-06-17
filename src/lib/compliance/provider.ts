/**
 * Compliance provider abstraction.
 *
 * Real vendors (KYC, geolocation, sanctions screening) are integrated behind
 * this interface. Business logic (gates.ts) depends ONLY on this interface and
 * never on a specific vendor or on hard-coded approvals. The mock provider is
 * used in development; production wires a real implementation.
 */

export type KycDecision = "APPROVED" | "PENDING" | "REJECTED";
export type GeoDecision = "ALLOWED" | "BLOCKED" | "UNKNOWN";

export interface KycResult {
  decision: KycDecision;
  /** Vendor reference for audit. */
  reference?: string;
  reasons?: string[];
}

export interface GeoResult {
  decision: GeoDecision;
  country?: string;
  region?: string;
  reasons?: string[];
}

export interface SanctionsResult {
  blocked: boolean;
  matchedList?: string;
  reasons?: string[];
}

export interface ComplianceContext {
  userId: string;
  email?: string | null;
  ipAddress?: string | null;
  declaredCountry?: string | null;
}

/**
 * The contract every compliance provider must implement. Methods are async to
 * match real vendor HTTP/SDK calls.
 */
export interface ComplianceProvider {
  readonly name: string;
  /** Kick off / fetch KYC status for a user. */
  checkKyc(ctx: ComplianceContext): Promise<KycResult>;
  /** Resolve geolocation eligibility (geofencing). */
  checkGeo(ctx: ComplianceContext): Promise<GeoResult>;
  /** Sanctions / blocklist screening. */
  checkSanctions(ctx: ComplianceContext): Promise<SanctionsResult>;
}
