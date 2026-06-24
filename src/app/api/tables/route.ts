import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/require-user";
import { prisma } from "@/lib/db/prisma";
import { parseAmount } from "@/lib/ledger/money";
import { generateInviteCode, hashPassword } from "@/lib/crypto";
import { writeAuditLog } from "@/lib/auth/audit";
import { tooMany } from "@/lib/security/rate-limit";
import { isTokenConfigured, env } from "@/lib/env";

const createSchema = z.object({
  name: z.string().min(2).max(40),
  asset: z.enum(["SOL", "USDC", "TOKEN"]),
  maxSeats: z.union([z.literal(2), z.literal(6), z.literal(9)]),
  smallBlind: z.string(),
  bigBlind: z.string(),
  minBuyIn: z.string(),
  maxBuyIn: z.string(),
  visibility: z.enum(["PUBLIC", "PRIVATE"]),
  password: z.string().max(64).optional(),
  actionTimeoutSeconds: z.number().int().min(10).max(120).default(30),
  spectatorsAllowed: z.boolean().default(true),
});

export async function POST(req: Request) {
  // One outer try/catch so this handler ALWAYS responds with JSON — an unhandled
  // throw here used to return an empty-body 500, which the client then tried to
  // `res.json()` (→ "Unexpected end of JSON input") and hung on "Creating…".
  try {
    const limited = tooMany(req, "table-create", { capacity: 8, refillPerSec: 0.1 });
    if (limited) return limited;

    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const c = parsed.data;

    // Asset/visibility policy:
    //  - PUBLIC tables may ONLY be denominated in the custom token.
    //  - PRIVATE tables may use SOL, USDC, or the token.
    //  - The token is only selectable once its mint is configured.
    if (c.asset === "TOKEN" && !isTokenConfigured()) {
      return NextResponse.json(
        { error: "Token play is not available yet" },
        { status: 400 },
      );
    }
    if (c.visibility === "PUBLIC" && c.asset !== "TOKEN") {
      return NextResponse.json(
        {
          error: `Public tables must use ${env.tokenSymbol}. Choose SOL or USDC only for private tables.`,
        },
        { status: 400 },
      );
    }

    // Server-overload guard: cap concurrent private games. When full, host has to
    // wait for one to free up.
    if (c.visibility === "PRIVATE") {
      const active = await prisma.pokerTable.count({
        where: { visibility: "PRIVATE", status: { in: ["WAITING", "ACTIVE"] } },
      });
      if (active >= env.maxPrivateTables) {
        return NextResponse.json(
          {
            error: `All private tables are full (${active}/${env.maxPrivateTables}). Please wait for one to open up.`,
          },
          { status: 503 },
        );
      }
    }

    const asset = c.asset;
    let smallBlind: bigint;
    let bigBlind: bigint;
    let minBuyIn: bigint;
    let maxBuyIn: bigint;
    try {
      smallBlind = parseAmount(asset, c.smallBlind);
      bigBlind = parseAmount(asset, c.bigBlind);
      minBuyIn = parseAmount(asset, c.minBuyIn);
      maxBuyIn = parseAmount(asset, c.maxBuyIn);
    } catch (err) {
      // A malformed number is player input, not a server fault — 400, not 500.
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Invalid blind or buy-in amount" },
        { status: 400 },
      );
    }

    // Hosts set their own stakes freely. The ONLY rules are the ones a poker game
    // mathematically requires — positive amounts, big blind above the small
    // blind, and a max buy-in at least the min. No arbitrary floors or ratios.
    if (smallBlind <= 0n || bigBlind <= 0n || minBuyIn <= 0n || maxBuyIn <= 0n) {
      return NextResponse.json(
        { error: "Blinds and buy-ins must be greater than zero" },
        { status: 400 },
      );
    }
    if (bigBlind <= smallBlind) {
      return NextResponse.json(
        { error: "Big blind must exceed small blind" },
        { status: 400 },
      );
    }
    if (maxBuyIn < minBuyIn) {
      return NextResponse.json(
        { error: "Max buy-in must be at least the min buy-in" },
        { status: 400 },
      );
    }

    const table = await prisma.pokerTable.create({
      data: {
        hostUserId: user.id,
        name: c.name,
        asset,
        smallBlind,
        bigBlind,
        minBuyIn,
        maxBuyIn,
        maxSeats: c.maxSeats,
        visibility: c.visibility,
        // Private tables rake 2% (split 1% house treasury / 1% token buyback).
        rakeBps: c.visibility === "PRIVATE" ? 200 : 0,
        passwordHash: c.password ? hashPassword(c.password) : null,
        inviteCode: generateInviteCode(),
        actionTimeoutSeconds: c.actionTimeoutSeconds,
        spectatorsAllowed: c.spectatorsAllowed,
        status: "WAITING",
      },
    });

    await writeAuditLog({
      actorUserId: user.id,
      action: "TABLE_CREATED",
      targetType: "PokerTable",
      targetId: table.id,
      metadata: { name: table.name, asset },
    });

    return NextResponse.json({ id: table.id, inviteCode: table.inviteCode });
  } catch (err) {
    // Surface the real reason in Railway logs, and always return JSON so the
    // client can show a proper error instead of spinning forever.
    console.error("[/api/tables] create failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create table" },
      { status: 500 },
    );
  }
}
