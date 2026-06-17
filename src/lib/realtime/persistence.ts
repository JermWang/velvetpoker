/**
 * Hand persistence for the realtime table room. Writes Hand / HandAction /
 * HandResult / RngProof rows and routes per-hand settlement through the ledger.
 * Shared by the WebSocket server and the verification harness so both persist
 * identically.
 */

import { prisma } from "@/lib/db/prisma";
import { settleHandLedger } from "@/lib/ledger/ledger";
import type { Asset } from "@prisma/client";
import type {
  HandCompletedInfo,
  HandSettlement,
  HandStartedInfo,
  TableRoom,
} from "./table-room";

interface PersistTable {
  id: string;
  asset: Asset;
}

export async function persistHandSettled(
  table: PersistTable,
  s: HandSettlement,
): Promise<void> {
  // The room's handId is "tableId:handNumber"; resolve it to the DB Hand.id so
  // ledger entries link to the persisted Hand row (admin/history join on it).
  const dbHandId = await resolveDbHandId(table.id, s.handId);
  await settleHandLedger({
    asset: table.asset,
    tableId: table.id,
    handId: dbHandId,
    correlationId: `hand-settle:${dbHandId}`,
    deltas: s.deltas.map((d) => ({ userId: d.playerId, net: d.net })),
    rake: s.rake,
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
  room.onHandSettled = (s) =>
    persistHandSettled(table, s).catch((e) =>
      console.error("[persist] settle failed", e),
    );
  room.onHandStarted = (i) =>
    persistHandStarted(i).catch((e) =>
      console.error("[persist] start failed", e),
    );
  room.onHandCompleted = async (i) => {
    try {
      await persistHandCompleted(i);
    } catch (e) {
      console.error("[persist] complete failed", e);
    }
    hooks?.afterHandCompleted?.(i);
  };
}
