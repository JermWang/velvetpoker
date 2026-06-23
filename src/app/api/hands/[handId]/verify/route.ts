import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { verifyShuffleProof, ALGORITHM } from "@/lib/poker/rng";
import { buildHandAnchorProof } from "@/lib/jobs/anchor";

/**
 * Returns the verifiable-shuffle proof for a completed hand and a server-side
 * recomputation result, plus the on-chain outcome anchor (Merkle proof + the
 * memo tx that commits the batch root) when the hand has been anchored. Clients
 * may independently recompute the deck (see /legal/rules) AND fold the Merkle
 * proof to confirm the outcome matches what was posted on-chain.
 */
export async function GET(
  _req: Request,
  { params }: { params: { handId: string } },
) {
  // Accept BOTH forms: the cuid Hand.id (used from history) and the realtime
  // room's composite "tableId:handNumber" (used from the live table). The live
  // table only knows the composite id, so without this the verify drawer 404s
  // for every in-progress hand.
  const raw = decodeURIComponent(params.handId);
  const colon = raw.lastIndexOf(":");
  const hand = await (async () => {
    if (colon > 0) {
      const tableId = raw.slice(0, colon);
      const handNumber = Number(raw.slice(colon + 1));
      if (tableId && Number.isFinite(handNumber)) {
        return prisma.hand.findUnique({
          where: { tableId_handNumber: { tableId, handNumber } },
          include: { rngProof: true },
        });
      }
    }
    return prisma.hand.findUnique({
      where: { id: raw },
      include: { rngProof: true },
    });
  })();
  if (!hand) {
    return NextResponse.json({ error: "Hand not found" }, { status: 404 });
  }

  const clientSeeds = (hand.rngProof?.clientSeeds as string[] | undefined) ?? [];
  const proof = {
    algorithm: hand.rngProof?.algorithm ?? ALGORITHM,
    serverSeedHash: hand.serverSeedHash,
    serverSeed: hand.serverSeed,
    clientSeeds,
    tableId: hand.tableId,
    // The realtime room derives the deck from `${tableId}:${handNumber}`, so the
    // verifier must reconstruct that exact handId to recompute a matching deck.
    handId: `${hand.tableId}:${hand.handNumber}`,
    deckHash: hand.deckHash,
  };

  const result = verifyShuffleProof(proof);
  const anchor = await buildHandAnchorProof(hand.id);

  return NextResponse.json({ proof, result, anchor });
}
