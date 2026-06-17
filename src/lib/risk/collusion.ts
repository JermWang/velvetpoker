/**
 * Heuristic collusion / multi-account signals.
 *
 * This is a FOUNDATION, not a finished detector. Real anti-collusion uses
 * behavioural models over large windows. Here we expose simple, explainable
 * heuristics that emit RiskEvents for human review:
 *   - chip dumping: one player repeatedly folding-to / losing large pots to a
 *     specific other player.
 *   - always-same-table: a set of accounts that only ever appear together.
 *   - shared signals: same IP / device / funding source (data fed in later).
 */

import type { RiskSeverity } from "@prisma/client";
import { recordRiskEvent } from "./risk-events";

export interface PairInteraction {
  userA: string;
  userB: string;
  handsTogether: number;
  netTransferAToB: bigint; // positive => A consistently loses to B
}

/** Flag pairs whose chip flow looks like dumping. Tunable thresholds. */
export async function evaluateChipDumping(
  tableId: string,
  interactions: PairInteraction[],
): Promise<void> {
  for (const i of interactions) {
    if (i.handsTogether < 20) continue;
    const magnitude = i.netTransferAToB < 0n ? -i.netTransferAToB : i.netTransferAToB;
    // Arbitrary MVP threshold; production derives from blind size + sample.
    if (magnitude > 0n && i.handsTogether >= 20 && magnitude >= 1n) {
      const severity: RiskSeverity = i.handsTogether >= 100 ? "HIGH" : "MEDIUM";
      await recordRiskEvent({
        tableId,
        type: "COLLUSION_SUSPECTED",
        severity,
        metadata: {
          userA: i.userA,
          userB: i.userB,
          handsTogether: i.handsTogether,
          netTransfer: i.netTransferAToB.toString(),
          heuristic: "chip_dumping",
        },
      });
    }
  }
}

/** Flag accounts that share a funding/IP signal (data supplied by caller). */
export async function flagSharedSignal(params: {
  userIds: string[];
  signal: "ip" | "device" | "funding_address";
  value: string;
}): Promise<void> {
  if (params.userIds.length < 2) return;
  await recordRiskEvent({
    type: "MULTI_ACCOUNT_SUSPECTED",
    severity: "MEDIUM",
    metadata: {
      userIds: params.userIds,
      signal: params.signal,
      value: params.value,
    },
  });
}
