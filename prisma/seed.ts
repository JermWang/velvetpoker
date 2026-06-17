/**
 * Seed data for local development.
 *
 * Creates an admin + two players, credits starting balances THROUGH the ledger
 * (never by writing Balance directly), and opens one public SOL table.
 *
 * Run: `npm run prisma:seed`
 */

import { PrismaClient } from "@prisma/client";
import { creditDeposit } from "../src/lib/ledger/ledger";
import { parseSolToLamports, parseUsdcToBaseUnits } from "../src/lib/ledger/money";
import { generateInviteCode } from "../src/lib/crypto";

const prisma = new PrismaClient();

const ADMIN_EMAIL = (process.env.ADMIN_EMAILS ?? "meesdontmiss@gmail.com")
  .split(",")[0]!
  .trim()
  .toLowerCase();

async function ensureUser(email: string, role: "USER" | "ADMIN") {
  return prisma.user.upsert({
    where: { privyUserId: `dev:${email}` },
    create: {
      privyUserId: `dev:${email}`,
      email,
      displayName: email.split("@")[0],
      role,
      status: "ACTIVE",
      kycStatus: "APPROVED",
      geofenceStatus: "ALLOWED",
      ageVerifiedAt: new Date(),
      country: "US",
    },
    update: { role, kycStatus: "APPROVED", geofenceStatus: "ALLOWED" },
  });
}

async function main() {
  console.log("Seeding Velvet Poker…");

  const admin = await ensureUser(ADMIN_EMAIL, "ADMIN");
  const alice = await ensureUser("alice@example.com", "USER");
  const bob = await ensureUser("bob@example.com", "USER");

  // Credit starting balances via the ledger (idempotent-ish by correlationId).
  for (const u of [admin, alice, bob]) {
    const solCorr = `seed-deposit-sol:${u.id}`;
    const usdcCorr = `seed-deposit-usdc:${u.id}`;
    const already = await prisma.ledgerEntry.findFirst({
      where: { correlationId: solCorr },
    });
    if (!already) {
      await creditDeposit({
        userId: u.id,
        asset: "SOL",
        amount: parseSolToLamports("25"),
        correlationId: solCorr,
        metadata: { seed: true },
      });
      await creditDeposit({
        userId: u.id,
        asset: "USDC",
        amount: parseUsdcToBaseUnits("5000"),
        correlationId: usdcCorr,
        metadata: { seed: true },
      });
    }
  }

  // One public SOL table.
  const existingTable = await prisma.pokerTable.findFirst({
    where: { name: "The Velvet Room" },
  });
  if (!existingTable) {
    await prisma.pokerTable.create({
      data: {
        hostUserId: admin.id,
        name: "The Velvet Room",
        asset: "SOL",
        smallBlind: parseSolToLamports("0.01"),
        bigBlind: parseSolToLamports("0.02"),
        minBuyIn: parseSolToLamports("1"),
        maxBuyIn: parseSolToLamports("4"),
        maxSeats: 6,
        visibility: "PUBLIC",
        inviteCode: generateInviteCode(),
        status: "WAITING",
        actionTimeoutSeconds: 30,
      },
    });
  }

  console.log("Seed complete.");
  console.log(`  Admin: ${ADMIN_EMAIL}`);
  console.log("  Players: alice@example.com, bob@example.com");
  console.log("  Each funded with 25 SOL + 5000 USDC (via ledger).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
