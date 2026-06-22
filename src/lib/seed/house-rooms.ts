/**
 * The house cash games — two dollar-pegged stake tiers + a free-play demo.
 * Idempotent: keyed on a stable inviteCode so re-running updates, never dupes.
 * Cash rooms take the 3% house rake (team / buyback / referrals).
 *
 * Tiers are defined in USD ($20 entry + the $100 "Velvet Room"). When the token is
 * live and has a market price, the rooms are denominated in the TOKEN, with
 * amounts pegged to those dollar values at the launch price (so the lobby shows
 * "$20" with the equivalent token amount as the translation). Until the token
 * has a price, they fall back to USDC so the lobby stays playable.
 */

import { prisma } from "@/lib/db/prisma";
import { DEFAULT_RAKE_BPS } from "@/lib/poker/rake";
import { env, isTokenConfigured } from "@/lib/env";
import { getAssetPrices } from "@/lib/pricing/prices";

/** SOL amount (decimal) -> lamports (free-play demo only). */
function sol(n: number): bigint {
  return BigInt(Math.round(n * 1e9));
}
/** USD dollars -> USDC base units (6 decimals). */
function usdcUnits(usd: number): bigint {
  return BigInt(Math.round(usd * 1_000_000));
}
/** USD dollars -> token base units at a given token USD price. */
function tokenUnits(usd: number, tokenUsd: number, decimals: number): bigint {
  return BigInt(Math.round((usd / tokenUsd) * 10 ** decimals));
}

// Dollar-defined tiers. The highest is always branded "The Velvet Room".
interface Tier {
  code: string;
  usd: number; // headline buy-in (display label)
  sbUsd: number;
  bbUsd: number;
  minUsd: number;
  maxUsd: number;
}
// Two cash options: a $20 entry tier and the flagship "The Velvet Room" ($100).
const TIERS: Tier[] = [
  { code: "HOUSE-MICRO", usd: 20, sbUsd: 0.1, bbUsd: 0.2, minUsd: 10, maxUsd: 20 },
  { code: "HOUSE-MID", usd: 100, sbUsd: 0.5, bbUsd: 1, minUsd: 50, maxUsd: 100 },
];
const HIGHEST_USD = Math.max(...TIERS.map((t) => t.usd));
const nameFor = (t: Tier) =>
  t.usd === HIGHEST_USD ? "The Velvet Room" : `Velvet — $${t.usd}`;

export interface HouseRoom {
  code: string;
  name: string;
  sb: bigint;
  bb: bigint;
  minBuyIn: bigint;
  maxBuyIn: bigint;
}

const DEMO_ROOM: HouseRoom = {
  code: "DEMO-FREEPLAY",
  name: "Velvet — Free Play",
  sb: sol(0.01),
  bb: sol(0.02),
  minBuyIn: sol(0.8),
  maxBuyIn: sol(4),
};

async function upsertRoom(
  r: HouseRoom,
  isDemo: boolean,
  asset: "SOL" | "USDC" | "TOKEN",
): Promise<void> {
  const fields = {
    name: r.name,
    smallBlind: r.sb,
    bigBlind: r.bb,
    minBuyIn: r.minBuyIn,
    maxBuyIn: r.maxBuyIn,
    visibility: "PUBLIC" as const,
    status: "WAITING" as const,
    rakeBps: isDemo ? 0 : DEFAULT_RAKE_BPS,
  };
  await prisma.pokerTable.upsert({
    where: { inviteCode: r.code },
    create: {
      ...fields,
      asset,
      maxSeats: 6,
      inviteCode: r.code,
      actionTimeoutSeconds: 30,
      spectatorsAllowed: true,
      isDemo,
    },
    update: { ...fields, asset, isDemo },
  });
}

export async function seedHouseRooms(): Promise<number> {
  // Free-play demo (no real money) always seeds.
  await upsertRoom(DEMO_ROOM, true, "SOL");

  // Prune any house room no longer in the set (e.g. retired tiers).
  const keep = ["DEMO-FREEPLAY", ...TIERS.map((t) => t.code)];
  await prisma.pokerTable.deleteMany({
    where: { inviteCode: { startsWith: "HOUSE-" }, NOT: { inviteCode: { in: keep } } },
  });

  // Prefer the token (pegged to the dollar tiers at the live price); fall back
  // to USDC until the token is configured and trading.
  const prices = isTokenConfigured() ? await getAssetPrices() : null;
  const tokenUsd = prices?.tokenUsd ?? null;
  const useToken = isTokenConfigured() && tokenUsd != null && tokenUsd > 0;

  for (const t of TIERS) {
    const toUnits = useToken
      ? (usd: number) => tokenUnits(usd, tokenUsd as number, env.tokenDecimals)
      : usdcUnits;
    await upsertRoom(
      {
        code: t.code,
        name: nameFor(t),
        sb: toUnits(t.sbUsd),
        bb: toUnits(t.bbUsd),
        minBuyIn: toUnits(t.minUsd),
        maxBuyIn: toUnits(t.maxUsd),
      },
      false,
      useToken ? "TOKEN" : "USDC",
    );
  }
  return TIERS.length + 1;
}
