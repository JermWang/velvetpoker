/**
 * The house cash games — four public Hold'em rooms with escalating blinds, so
 * players always have a stake that fits their bankroll. Idempotent: keyed on a
 * stable inviteCode so re-running updates rather than duplicates. All take the
 * 3% house rake (split three ways: team / buyback / referrals).
 *
 * Public tables are token-only, so the house rooms are denominated in the
 * custom token (decimals from NEXT_PUBLIC_TOKEN_DECIMALS). Stakes below are in
 * WHOLE TOKENS — adjust to taste. Buy-ins are derived from the big blind:
 * min 40bb, max 200bb.
 */

import { prisma } from "@/lib/db/prisma";
import { DEFAULT_RAKE_BPS } from "@/lib/poker/rake";
import { env, isTokenConfigured } from "@/lib/env";

/** Whole-token amount -> base units, using the configured token decimals. */
function token(n: number): bigint {
  const decimals = BigInt(env.tokenDecimals);
  // Integer math: split whole/fraction to avoid float base-unit drift.
  const parts = n.toString().split(".");
  const whole = parts[0] ?? "0";
  const frac = parts[1] ?? "";
  const fracPadded = frac.padEnd(Number(decimals), "0").slice(0, Number(decimals));
  return BigInt(whole) * 10n ** decimals + BigInt(fracPadded || "0");
}

/** SOL amount (decimal) -> lamports (used only by the free-play demo room). */
function sol(n: number): bigint {
  return BigInt(Math.round(n * 1e9));
}

/** Buy-in range as multiples of the big blind. */
const MIN_BUYIN_BB = 40n;
const MAX_BUYIN_BB = 200n;

export interface HouseRoom {
  code: string;
  name: string;
  sb: bigint;
  bb: bigint;
}

// Token-denominated public rooms (whole-token stakes). Blinds escalate ~5x/tier.
// Kept to three tiers + the free-play demo = four lobbies total.
export const HOUSE_ROOMS: HouseRoom[] = [
  { code: "HOUSE-MICRO", name: "Velvet — Micro", sb: token(10), bb: token(20) },
  { code: "HOUSE-LOW", name: "Velvet — Low", sb: token(50), bb: token(100) },
  { code: "HOUSE-MID", name: "Velvet — Mid", sb: token(250), bb: token(500) },
];

// Free-play demo table: free chips, no real money, open to wallet-less guests.
// Stays SOL-denominated — it's nominal (free chips), exempt from the token rule.
const DEMO_ROOM: HouseRoom = {
  code: "DEMO-FREEPLAY",
  name: "Velvet — Free Play",
  sb: sol(0.01),
  bb: sol(0.02),
};

async function upsertRoom(
  r: HouseRoom,
  isDemo: boolean,
  asset: "SOL" | "TOKEN",
): Promise<void> {
  const minBuyIn = r.bb * MIN_BUYIN_BB;
  const maxBuyIn = r.bb * MAX_BUYIN_BB;
  const fields = {
    name: r.name,
    smallBlind: r.sb,
    bigBlind: r.bb,
    minBuyIn,
    maxBuyIn,
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
  // The free-play demo room always seeds (no real money).
  await upsertRoom(DEMO_ROOM, true, "SOL");

  // Prune any house room no longer in the set (e.g. retired high-stakes tiers),
  // so re-running the seed converges to exactly the rooms defined here.
  const keep = ["DEMO-FREEPLAY", ...HOUSE_ROOMS.map((r) => r.code)];
  await prisma.pokerTable.deleteMany({
    where: { inviteCode: { startsWith: "HOUSE-" }, NOT: { inviteCode: { in: keep } } },
  });

  // Real public rooms are token-denominated and require the token to be set.
  if (!isTokenConfigured()) {
    console.warn(
      "[seed] TOKEN_MINT not set — skipping token house rooms. Set the token env and re-run `npm run seed:rooms`.",
    );
    return 1; // just the demo
  }
  for (const r of HOUSE_ROOMS) await upsertRoom(r, false, "TOKEN");
  return HOUSE_ROOMS.length + 1; // + the free-play demo table
}
