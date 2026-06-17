/**
 * The house cash games — four public Hold'em rooms with escalating blinds, so
 * players always have a stake that fits their bankroll. Idempotent: keyed on a
 * stable inviteCode so re-running updates rather than duplicates. All take the
 * 3% house rake (split three ways: team / buyback / referrals).
 *
 * Buy-ins are derived from the big blind: min 40bb, max 200bb.
 */

import { prisma } from "@/lib/db/prisma";
import { DEFAULT_RAKE_BPS } from "@/lib/poker/rake";

/** SOL amount (decimal) -> lamports. */
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

// Blinds escalate ~5x per tier.
export const HOUSE_ROOMS: HouseRoom[] = [
  { code: "HOUSE-MICRO", name: "Velvet — Micro", sb: sol(0.001), bb: sol(0.002) },
  { code: "HOUSE-LOW", name: "Velvet — Low", sb: sol(0.005), bb: sol(0.01) },
  { code: "HOUSE-MID", name: "Velvet — Mid", sb: sol(0.025), bb: sol(0.05) },
  { code: "HOUSE-HIGH", name: "Velvet — High", sb: sol(0.1), bb: sol(0.2) },
];

// Free-play demo table: free chips, no real money, open to wallet-less guests.
const DEMO_ROOM: HouseRoom = {
  code: "DEMO-FREEPLAY",
  name: "Velvet — Free Play",
  sb: sol(0.01),
  bb: sol(0.02),
};

async function upsertRoom(r: HouseRoom, isDemo: boolean): Promise<void> {
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
      asset: "SOL",
      maxSeats: 6,
      inviteCode: r.code,
      actionTimeoutSeconds: 30,
      spectatorsAllowed: true,
      isDemo,
    },
    update: { ...fields, isDemo },
  });
}

export async function seedHouseRooms(): Promise<number> {
  await upsertRoom(DEMO_ROOM, true);
  for (const r of HOUSE_ROOMS) await upsertRoom(r, false);
  return HOUSE_ROOMS.length + 1; // + the free-play demo table
}
