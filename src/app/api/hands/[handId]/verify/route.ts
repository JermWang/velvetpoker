import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { verifyShuffleProof, ALGORITHM } from "@/lib/poker/rng";

/**
 * Returns the verifiable-shuffle proof for a completed hand and a server-side
 * recomputation result. Clients may also independently recompute the deck using
 * the documented algorithm (see /legal/rules) to confirm fairness.
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

  return NextResponse.json({ proof, result });
}
