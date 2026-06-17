/**
 * The house cash games — four public Hold'em rooms with escalating blinds, so
 * players always have a stake that fits their bankroll. Idempotent: keyed on a
 * stable inviteCode so re-running updates rather than duplicates. All take the
 * 3% house rake (split three ways: team / buyback / referrals).
 */

import { prisma } from "@/lib/db/prisma";
import { DEFAULT_RAKE_BPS } from "@/lib/poker/rake";

/** SOL amount (decimal) -> lamports. */
function sol(n: number): bigint {
  return BigInt(Math.round(n * 1e9));
}

export interface HouseRoom {
  code: string;
  name: string;
  sb: bigint;
  bb: bigint;
  min: bigint;
  max: bigint;
}

// Blinds escalate ~5x per tier; buy-ins are 40–100 big blinds.
export const HOUSE_ROOMS: HouseRoom[] = [
  { code: "HOUSE-MICRO", name: "Velvet — Micro", sb: sol(0.001), bb: sol(0.002), min: sol(0.08), max: sol(0.2) },
  { code: "HOUSE-LOW", name: "Velvet — Low", sb: sol(0.005), bb: sol(0.01), min: sol(0.4), max: sol(1) },
  { code: "HOUSE-MID", name: "Velvet — Mid", sb: sol(0.025), bb: sol(0.05), min: sol(2), max: sol(5) },
  { code: "HOUSE-HIGH", name: "Velvet — High", sb: sol(0.1), bb: sol(0.2), min: sol(8), max: sol(20) },
];

export async function seedHouseRooms(): Promise<number> {
  for (const r of HOUSE_ROOMS) {
    await prisma.pokerTable.upsert({
      where: { inviteCode: r.code },
      create: {
        name: r.name,
        asset: "SOL",
        smallBlind: r.sb,
        bigBlind: r.bb,
        minBuyIn: r.min,
        maxBuyIn: r.max,
        maxSeats: 6,
        visibility: "PUBLIC",
        inviteCode: r.code,
        status: "WAITING",
        actionTimeoutSeconds: 30,
        spectatorsAllowed: true,
        rakeBps: DEFAULT_RAKE_BPS,
      },
      update: {
        name: r.name,
        smallBlind: r.sb,
        bigBlind: r.bb,
        minBuyIn: r.min,
        maxBuyIn: r.max,
        visibility: "PUBLIC",
        status: "WAITING",
        rakeBps: DEFAULT_RAKE_BPS,
      },
    });
  }
  return HOUSE_ROOMS.length;
}
