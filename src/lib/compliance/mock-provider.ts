/**
 * Development-only mock compliance provider.
 *
 * Behaviour is controlled by ENABLE_DEV_COMPLIANCE_APPROVAL. This flag lives at
 * the provider boundary ONLY — business logic in gates.ts is identical in dev
 * and prod; it just consults whatever provider is wired in. A production build
 * must wire a real ComplianceProvider here instead.
 */

import { env } from "@/lib/env";
import type {
  ComplianceContext,
  ComplianceProvider,
  GeoResult,
  KycResult,
  SanctionsResult,
} from "./provider";

// Obvious sanctioned-country sample list for the mock. Real screening is a
// vendor API. ISO 3166-1 alpha-2.
const MOCK_BLOCKED_COUNTRIES = new Set(["KP", "IR", "SY", "CU"]);
const MOCK_BLOCKED_REGIONS_US = new Set(["WA", "ID", "NV"]); // sample state restrictions

export class MockComplianceProvider implements ComplianceProvider {
  readonly name = "mock";

  async checkKyc(_ctx: ComplianceContext): Promise<KycResult> {
    if (env.enableDevComplianceApproval) {
      return { decision: "APPROVED", reference: "mock-kyc-auto" };
    }
    // Without the dev flag, the mock leaves users PENDING so flows can be
    // exercised without auto-passing real-money gates.
    return { decision: "PENDING", reference: "mock-kyc-pending" };
  }

  async checkGeo(ctx: ComplianceContext): Promise<GeoResult> {
    const country = ctx.declaredCountry?.toUpperCase() ?? "US";
    if (MOCK_BLOCKED_COUNTRIES.has(country)) {
      return { decision: "BLOCKED", country, reasons: ["country_restricted"] };
    }
    if (env.enableDevComplianceApproval) {
      return { decision: "ALLOWED", country };
    }
    return { decision: "UNKNOWN", country, reasons: ["geo_unverified"] };
  }

  async checkSanctions(ctx: ComplianceContext): Promise<SanctionsResult> {
    const country = ctx.declaredCountry?.toUpperCase() ?? "US";
    if (MOCK_BLOCKED_COUNTRIES.has(country)) {
      return { blocked: true, matchedList: "mock-ofac", reasons: ["country"] };
    }
    return { blocked: false };
  }
}

export function isRestrictedUsRegion(region: string | null | undefined): boolean {
  if (!region) return false;
  return MOCK_BLOCKED_REGIONS_US.has(region.toUpperCase());
}
