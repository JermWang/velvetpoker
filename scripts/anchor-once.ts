/**
 * One-shot anchor validation: anchors any completed-but-unanchored hands using
 * the configured provider (mock when no hot wallet) and verifies the resulting
 * Merkle proof folds back to the anchored root. For local/integration checks.
 */

import { prisma } from "@/lib/db/prisma";
import { runAnchorOnce, buildHandAnchorProof } from "@/lib/jobs/anchor";
import { setSolanaProvider } from "@/lib/solana/connection";
import { MockSolanaProvider } from "@/lib/solana/mock-provider";

async function main() {
  // Validate the proof pipeline without spending real fees — the on-chain memo
  // post is exercised separately once the hot wallet is funded.
  setSolanaProvider(new MockSolanaProvider());

  const candidate = await prisma.hand.findFirst({
    where: { status: "COMPLETE", anchorId: null },
    orderBy: { completedAt: "asc" },
  });
  console.log("candidate hand:", candidate?.id ?? "none");

  const res = await runAnchorOnce();
  console.log("runAnchorOnce ->", res);

  if (candidate) {
    const p = await buildHandAnchorProof(candidate.id);
    console.log("proof.anchored:", p.anchored);
    console.log("proof.rootMatches:", p.rootMatches);
    console.log("proof.merkleRoot:", p.merkleRoot);
    console.log("proof.txSignature:", p.txSignature);
    console.log("proof steps:", p.proof?.length);
    if (!p.rootMatches) throw new Error("ROOT MISMATCH — proof does not verify");
    console.log("OK: hand verifies against the anchored root");
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
