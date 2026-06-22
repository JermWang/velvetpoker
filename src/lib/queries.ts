/** Shared read helpers for server components. */

import { prisma } from "@/lib/db/prisma";
import type { Asset } from "@/lib/ledger/money";
import type { BalanceView } from "@/components/app-shell/balance-pill";
import { isTokenConfigured } from "@/lib/env";

// Show the token balance only once the token is configured.
const ASSETS: Asset[] = isTokenConfigured()
  ? ["SOL", "USDC", "TOKEN"]
  : ["SOL", "USDC"];

export async function getUserBalances(userId: string): Promise<BalanceView[]> {
  const rows = await prisma.balance.findMany({ where: { userId } });
  return ASSETS.map((asset) => {
    const row = rows.find((r) => r.asset === asset);
    return {
      asset,
      available: row?.availableAmount ?? 0n,
      locked: row?.lockedAmount ?? 0n,
    };
  });
}
