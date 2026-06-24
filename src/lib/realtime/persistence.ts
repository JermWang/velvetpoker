/**
 * Hand persistence for the realtime table room. Writes Hand / HandAction /
 * HandResult / RngProof rows and routes per-hand settlement through the ledger.
 * Shared by the WebSocket server and the verification harness so both persist
 * identically.
 */

import { prisma } from "@/lib/db/prisma";
import { settleHandLedger, type RakeSplit } from "@/lib/ledger/ledger";
import { splitRakeThreeWays, splitRakePrivate } from "@/lib/poker/rake";
import { recordOpsFailure } from "@/lib/risk/risk-events";
import type { Asset } from "@prisma/client";

/**
 * Reconstruct each player's current at-table stack from the ledger: the net of
 * their USER_TABLE_LOCKED entries for this table IS their seated stack (it only
 * moves at buy-in, cash-out, and settlement — all atomic). Used to rebuild a
 * table room after a process restart so locked funds are never stranded.
 */
export async function reconstructSeatedStacks(
  tableId: string,
  asset: Asset,
): Promise<Array<{ playerId: string; displayName: string; stack: bigint }>> {
  const grouped = await prisma.ledgerEntry.groupBy({
    by: ["userId", "direction"],
    where: {
      tableId,
      asset,
      accountType: "USER_TABLE_LOCKED",
      userId: { not: null },
    },
    _sum: { amount: true },
  });

  const net = new Map<string, bigint>();
  for (const g of grouped) {
    if (!g.userId) continue;
    const sign = g.direction === "CREDIT" ? 1n : -1n;
    net.set(g.userId, (net.get(g.userId) ?? 0n) + sign * (g._sum.amount ?? 0n));
  }

  const seated = [...net.entries()].filter(([, v]) => v > 0n);
  if (seated.length === 0) return [];

  const users = await prisma.user.findMany({
    where: { id: { in: seated.map(([id]) => id) } },
    select: { id: true, displayName: true },
  });
  const nameById = new Map(users.map((u) => [u.id, u.displayName ?? "Player"]));

  return seated.map(([playerId, stack]) => ({
    playerId,
    displayName: nameById.get(playerId) ?? "Player",
    stack,
  }));
}
import type {
  HandCompletedInfo,
  HandSettlement,
  HandStartedInfo,
  TableRoom,
} from "./table-room";

interface PersistTable {
  id: string;
  asset: Asset;
  /** Private tables rake 2% split 1% house / 1% buyback (no referral pool). */
  isPrivate?: boolean;
}

export async function persistHandSettled(
  table: PersistTable,
  s: HandSettlement,
): Promise<void> {
  // The room's handId is "tableId:handNumber"; resolve it to the DB Hand.id so
  // ledger entries link to the persisted Hand row (admin/history join on it).
  const dbHandId = await resolveDbHandId(table.id, s.handId);

  // Private tables: 2% rake split 1% house treasury / 1% buyback, no referral.
  let rakeSplit: RakeSplit | undefined;
  if (s.rake > 0n && table.isPrivate) {
    const { team, buyback } = splitRakePrivate(s.rake);
    rakeSplit = { team, buyback, referralPayouts: [] };
  } else if (s.rake > 0n) {
    // Public/house tables: split the rake three ways. The referral third is
    // attributed to the referrers of contributing players, proportional to pot
    // contribution; any slice for a player with no referrer stays with the house.
    const { team, buyback, referral } = splitRakeThreeWays(s.rake);
    const totalContribution = s.contributions.reduce((a, c) => a + c.amount, 0n);

    const playerIds = s.contributions.map((c) => c.playerId);
    const users = playerIds.length
      ? await prisma.user.findMany({
          where: { id: { in: playerIds } },
          select: { id: true, referredById: true },
        })
      : [];
    const referrerOf = new Map(users.map((u) => [u.id, u.referredById]));

    const payoutByReferrer = new Map<string, bigint>();
    let referralDistributed = 0n;
    if (referral > 0n && totalContribution > 0n) {
      for (const c of s.contributions) {
        const referrer = referrerOf.get(c.playerId);
        if (!referrer) continue;
        const share = (referral * c.amount) / totalContribution;
        if (share > 0n) {
          payoutByReferrer.set(
            referrer,
            (payoutByReferrer.get(referrer) ?? 0n) + share,
          );
          referralDistributed += share;
        }
      }
    }
    const referralUnattributed = referral - referralDistributed; // → house

    rakeSplit = {
      team: team + referralUnattributed,
      buyback,
      referralPayouts: [...payoutByReferrer].map(([referrerUserId, amount]) => ({
        referrerUserId,
        amount,
      })),
    };
  }

  await settleHandLedger({
    asset: table.asset,
    tableId: table.id,
    handId: dbHandId,
    correlationId: `hand-settle:${dbHandId}`,
    deltas: s.deltas.map((d) => ({ userId: d.playerId, net: d.net })),
    rakeSplit,
  });
}

/** Map a room handId ("tableId:handNumber") to the persisted Hand.id (cuid). */
async function resolveDbHandId(tableId: string, roomHandId: string): Promise<string> {
  const handNumber = Number(roomHandId.split(":").pop());
  if (!Number.isFinite(handNumber)) return roomHandId;
  const hand = await prisma.hand.findUnique({
    where: { tableId_handNumber: { tableId, handNumber } },
  });
  return hand?.id ?? roomHandId;
}

export async function persistHandStarted(
  info: HandStartedInfo,
): Promise<void> {
  const hand = await prisma.hand.upsert({
    where: {
      tableId_handNumber: {
        tableId: info.tableId,
        handNumber: info.handNumber,
      },
    },
    create: {
      tableId: info.tableId,
      handNumber: info.handNumber,
      dealerSeat: info.dealerSeat,
      smallBlindSeat: info.smallBlindSeat,
      bigBlindSeat: info.bigBlindSeat,
      status: "PREFLOP",
      serverSeedHash: info.serverSeedHash,
      deckHash: info.deckHash,
    },
    update: { status: "PREFLOP" },
  });
  await prisma.rngProof.upsert({
    where: { handId: hand.id },
    create: {
      handId: hand.id,
      serverSeedHash: info.serverSeedHash,
      clientSeeds: info.clientSeeds,
      algorithm: info.algorithm,
      verified: false,
    },
    update: {},
  });
}

export async function persistHandCompleted(
  info: HandCompletedInfo,
): Promise<void> {
  const hand = await prisma.hand.findUnique({
    where: {
      tableId_handNumber: {
        tableId: info.tableId,
        handNumber: info.handNumber,
      },
    },
  });
  if (!hand) return;
  await prisma.$transaction(async (tx) => {
    await tx.hand.update({
      where: { id: hand.id },
      data: {
        status: "COMPLETE",
        serverSeed: info.serverSeed,
        potAmount: info.potAmount,
        rakeAmount: info.rake,
        completedAt: new Date(),
      },
    });
    await tx.handAction.createMany({
      data: info.actions.map((a) => ({
        handId: hand.id,
        userId: a.playerId,
        seatNumber: a.seat,
        action: a.type,
        amount: a.amount,
        street: a.street as "PREFLOP" | "FLOP" | "TURN" | "RIVER" | "SHOWDOWN",
      })),
    });
    await tx.handResult.createMany({
      data: info.results.map((r) => ({
        handId: hand.id,
        userId: r.playerId,
        seatNumber: r.seat,
        amountWon: r.amountWon,
        handDescription: r.handDescription,
        cards: r.cards,
      })),
    });
    await tx.rngProof.update({
      where: { handId: hand.id },
      data: { serverSeed: info.serverSeed, verified: true },
    });
  });
}

/** Wire all three persistence hooks onto a room. */
export function attachHandPersistence(
  room: TableRoom,
  table: PersistTable,
  hooks?: { afterHandCompleted?: (info: HandCompletedInfo) => void },
): void {
  // The hooks fire-and-forget from the engine, but the Hand row written at deal
  // (persistHandStarted) MUST exist before settlement/completion link to it.
  // Chain on the latest start so completion + settlement always observe it,
  // closing a race that would otherwise drop a hand's settlement under fast play.
  let startPersisted: Promise<unknown> = Promise.resolve();

  room.onHandStarted = (i) => {
    startPersisted = persistHandStarted(i).catch((e) =>
      console.error("[persist] start failed", e),
    );
  };
  room.onHandSettled = async (s) => {
    await startPersisted;
    try {
      await persistHandSettled(table, s);
    } catch (e) {
      // CRITICAL: the pot moved in memory but the ledger never recorded it, so
      // the live stacks now diverge from the source-of-truth ledger. Make it
      // loud — this needs immediate operator attention (and a reconciliation).
      console.error("[persist] settle failed", e);
      void recordOpsFailure(
        `CRITICAL hand-settlement ledger write FAILED for table ${table.id} hand ${s.handId}: ${String(
          e,
        )} — in-memory stacks now diverge from the ledger; reconcile.`,
        { kind: "settlement_write_failed", tableId: table.id, handId: s.handId },
      );
    }
  };
  room.onHandCompleted = async (i) => {
    await startPersisted;
    try {
      await persistHandCompleted(i);
    } catch (e) {
      console.error("[persist] complete failed", e);
      void recordOpsFailure(
        `hand-completion persistence FAILED for table ${i.tableId} hand #${i.handNumber}: ${String(
          e,
        )} — history/anchor rows may be incomplete.`,
        { kind: "hand_completion_failed", tableId: i.tableId, handNumber: i.handNumber },
      );
    }
    hooks?.afterHandCompleted?.(i);
  };
}
