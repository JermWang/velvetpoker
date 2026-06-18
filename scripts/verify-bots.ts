/**
 * Solo free-play verification: a SINGLE guest sits at the demo table and the
 * server should fill it with bots, deal, run the hand to completion with the
 * bots acting on their own, and start the next hand. Run: npm run verify:bots
 */

import WebSocket from "ws";
import { prisma } from "../src/lib/db/prisma";
import { startServer } from "../src/lib/realtime/server";

const PORT = 4098;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error("ASSERT FAILED: " + msg);
  console.log("  ✓ " + msg);
}

async function main() {
  console.log("Velvet Poker — solo bot play verification\n");
  const table = await prisma.pokerTable.findFirstOrThrow({
    where: { inviteCode: "DEMO-FREEPLAY" },
  });
  assert(table.isDemo, "free demo table exists");

  startServer(PORT);
  await sleep(400);

  const events: Record<string, unknown>[] = [];
  const ws = new WebSocket(`ws://localhost:${PORT}?guest=solotest1`);
  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => {
      ws.send(JSON.stringify({ t: "JOIN_TABLE", tableId: table.id }));
      resolve();
    });
    ws.on("message", (raw) => {
      const e = JSON.parse(raw.toString());
      events.push(e);
      if (e.t === "ACTION_REQUIRED") {
        const toCall = BigInt(e.toCall ?? "0");
        ws.send(
          JSON.stringify({
            t: "PLAYER_ACTION",
            tableId: table.id,
            action: toCall > 0n ? "CALL" : "CHECK",
          }),
        );
      }
    });
    ws.on("error", reject);
  });
  await sleep(300);

  // Take a free seat (alone).
  ws.send(JSON.stringify({ t: "BUY_IN", tableId: table.id, amount: table.maxBuyIn.toString() }));

  const saw = (t: string) => events.some((e) => e.t === t);
  const handsStarted = () => events.filter((e) => e.t === "HAND_STARTED").length;

  for (let i = 0; i < 40 && !saw("HAND_STARTED"); i++) await sleep(250);
  assert(saw("HAND_STARTED"), "a hand started for a SOLO human (bots filled the table)");

  const state = [...events].reverse().find((e) => e.t === "TABLE_STATE") as
    | { state?: { seats: { playerId: string | null }[] } }
    | undefined;
  const occupied = state?.state?.seats.filter((s) => s.playerId).length ?? 0;
  assert(occupied >= 2, `bots seated alongside the human (${occupied} seats filled)`);

  assert(saw("PRIVATE_CARDS"), "the solo human was dealt hole cards");

  for (let i = 0; i < 100 && !saw("HAND_COMPLETE"); i++) await sleep(250);
  assert(saw("HAND_COMPLETE"), "the hand played to completion with bots acting");

  const first = handsStarted();
  for (let i = 0; i < 60 && handsStarted() <= first; i++) await sleep(250);
  assert(handsStarted() > first, "a new hand begins after the previous (continuous play)");

  console.log("\n✅ SOLO BOT PLAY CHECKS PASSED");
  ws.close();
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("\n❌ FAILED:", e);
  await prisma.$disconnect();
  process.exit(1);
});
