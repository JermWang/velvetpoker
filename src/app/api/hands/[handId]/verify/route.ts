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
  const hand = await prisma.hand.findUnique({
    where: { id: params.handId },
    include: { rngProof: true },
  });
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
