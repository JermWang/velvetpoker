/**
 * The house cash games — three USDC stake tiers + a free-play demo, so the
 * lobby always shows clean, stable dollar stakes ($20 / $50 / $100 buy-ins).
 * Idempotent: keyed on a stable inviteCode so re-running updates rather than
 * duplicates. Cash rooms take the 3% house rake (team / buyback / referrals).
 *
 * USDC is stable (~$1), so these stakes stay exactly $20/$50/$100. The custom
 * token remains the currency for USER-created public tables (enforced in the
 * create-table API); the house rooms are seeded directly and use USDC by design.
 */

import { prisma } from "@/lib/db/prisma";
import { DEFAULT_RAKE_BPS } from "@/lib/poker/rake";

/** USDC amount (decimal dollars) -> base units (6 decimals), integer math. */
function usdc(n: number): bigint {
  const parts = n.toFixed(6).split(".");
  const whole = parts[0] ?? "0";
  const frac = (parts[1] ?? "").padEnd(6, "0").slice(0, 6);
  return BigInt(whole) * 1_000_000n + BigInt(frac || "0");
}

/** SOL amount (decimal) -> lamports (used only by the free-play demo room). */
function sol(n: number): bigint {
  return BigInt(Math.round(n * 1e9));
}

export interface HouseRoom {
  code: string;
  name: string;
  sb: bigint;
  bb: bigint;
  minBuyIn: bigint;
  maxBuyIn: bigint;
}

// USDC cash tiers (round dollar blinds + buy-in ranges). The highest tier is
// always branded "The Velvet Room"; lower tiers are named by their buy-in.
// Three tiers + the free-play demo = four lobbies total.
interface Tier {
  code: string;
  usd: number; // headline buy-in, also the display label
  sb: bigint;
  bb: bigint;
  minBuyIn: bigint;
  maxBuyIn: bigint;
}

const TIERS: Tier[] = [
  { code: "HOUSE-MICRO", usd: 20, sb: usdc(0.1), bb: usdc(0.2), minBuyIn: usdc(10), maxBuyIn: usdc(20) },
  { code: "HOUSE-LOW", usd: 50, sb: usdc(0.25), bb: usdc(0.5), minBuyIn: usdc(25), maxBuyIn: usdc(50) },
  { code: "HOUSE-MID", usd: 100, sb: usdc(0.5), bb: usdc(1), minBuyIn: usdc(50), maxBuyIn: usdc(100) },
];

// The highest-stakes tier (by buy-in) gets the flagship name.
const HIGHEST_USD = Math.max(...TIERS.map((t) => t.usd));

export const HOUSE_ROOMS: HouseRoom[] = TIERS.map((t) => ({
  code: t.code,
  name: t.usd === HIGHEST_USD ? "The Velvet Room" : `Velvet — $${t.usd}`,
  sb: t.sb,
  bb: t.bb,
  minBuyIn: t.minBuyIn,
  maxBuyIn: t.maxBuyIn,
}));

// Free-play demo table: free chips, no real money, open to wallet-less guests.
// Nominal SOL denomination — it's free play, the asset label is never charged.
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
  asset: "SOL" | "USDC",
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
  // Free-play demo (no real money) + the three USDC cash tiers.
  await upsertRoom(DEMO_ROOM, true, "SOL");

  // Prune any house room no longer in the set (e.g. retired tiers), so
  // re-running the seed converges to exactly the rooms defined here.
  const keep = ["DEMO-FREEPLAY", ...HOUSE_ROOMS.map((r) => r.code)];
  await prisma.pokerTable.deleteMany({
    where: { inviteCode: { startsWith: "HOUSE-" }, NOT: { inviteCode: { in: keep } } },
  });

  for (const r of HOUSE_ROOMS) await upsertRoom(r, false, "USDC");
  return HOUSE_ROOMS.length + 1; // + the free-play demo table
}
