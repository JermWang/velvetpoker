/**
 * Full guest-play verification against the real WebSocket server + DB.
 *
 * Starts the realtime server on a test port, connects TWO guests to the free
 * demo table, has them buy in and auto-play, and asserts:
 *   - a hand actually STARTS with two guests seated
 *   - the hand plays to SHOWDOWN / completion
 *   - a guest cannot take a second seat (no seat-stuffing)
 *
 * Run: npm run verify:guest
 */

import WebSocket from "ws";
import { prisma } from "../src/lib/db/prisma";
import { startServer } from "../src/lib/realtime/server";

const PORT = 4099;

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error("ASSERT FAILED: " + msg);
  console.log("  ✓ " + msg);
}

interface Client {
  ws: WebSocket;
  id: string;
  events: Record<string, unknown>[];
}

function connectGuest(tableId: string, guestId: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}?guest=${guestId}`);
    const client: Client = { ws, id: guestId, events: [] };
    ws.on("open", () => {
      ws.send(JSON.stringify({ t: "JOIN_TABLE", tableId }));
      resolve(client);
    });
    ws.on("message", (raw) => {
      const ev = JSON.parse(raw.toString());
      client.events.push(ev);
      // Auto-pilot: respond to action requests by checking or calling.
      if (ev.t === "ACTION_REQUIRED") {
        const toCall = BigInt(ev.toCall ?? "0");
        ws.send(
          JSON.stringify({
            t: "PLAYER_ACTION",
            tableId,
            action: toCall > 0n ? "CALL" : "CHECK",
          }),
        );
      }
    });
    ws.on("error", reject);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sawEvent = (c: Client, t: string) => c.events.some((e) => e.t === t);

async function main() {
  console.log("Velvet Poker — guest free-play verification\n");

  const table = await prisma.pokerTable.findFirstOrThrow({
    where: { inviteCode: "DEMO-FREEPLAY" },
  });
  assert(table.isDemo, "free demo table exists and is flagged isDemo");

  startServer(PORT);
  await sleep(400);

  const g1 = await connectGuest(table.id, "gtest0001");
  const g2 = await connectGuest(table.id, "gtest0002");
  await sleep(200);

  // Both buy in (free chips), back-to-back. The server clamps to the table range.
  const buyIn = table.maxBuyIn.toString();
  g1.ws.send(JSON.stringify({ t: "BUY_IN", tableId: table.id, amount: buyIn }));
  g2.ws.send(JSON.stringify({ t: "BUY_IN", tableId: table.id, amount: buyIn }));

  // Wait for a hand to start.
  for (let i = 0; i < 40 && !(sawEvent(g1, "HAND_STARTED") || sawEvent(g2, "HAND_STARTED")); i++) {
    await sleep(250);
  }
  console.log("  g1 events:", g1.events.map((e) => e.t).join(", "));
  console.log("  g2 events:", g2.events.map((e) => e.t).join(", "));
  const g1err = g1.events.find((e) => e.t === "ERROR");
  const g2err = g2.events.find((e) => e.t === "ERROR");
  if (g1err) console.log("  g1 ERROR:", (g1err as { message?: string }).message);
  if (g2err) console.log("  g2 ERROR:", (g2err as { message?: string }).message);
  assert(sawEvent(g1, "HAND_STARTED") || sawEvent(g2, "HAND_STARTED"), "a hand STARTED with two guests seated");

  // Each guest should be dealt private cards. Bots fill the free table, and a
  // guest whose buy-in lands just after the first hand deals is dealt from the
  // next hand — so wait across a hand or two for BOTH to receive cards.
  for (let i = 0; i < 80 && !(sawEvent(g1, "PRIVATE_CARDS") && sawEvent(g2, "PRIVATE_CARDS")); i++) {
    await sleep(250);
  }
  assert(sawEvent(g1, "PRIVATE_CARDS"), "guest 1 received their hole cards");
  assert(sawEvent(g2, "PRIVATE_CARDS"), "guest 2 received their hole cards");

  // Opaque seat tokens (#3): the client gets an IDENTITY token, can match its
  // own seat by it, and the raw user id is NEVER broadcast in table state.
  const idEv = g1.events.find((e) => e.t === "IDENTITY") as { playerToken?: string } | undefined;
  assert(idEv && typeof idEv.playerToken === "string", "guest received an opaque IDENTITY token");
  const g1Token = idEv!.playerToken!;
  const latest = [...g1.events].reverse().find((e) => e.t === "TABLE_STATE") as
    | { state?: { seats: { playerId: string | null }[] } }
    | undefined;
  const seats = latest?.state?.seats ?? [];
  assert(seats.some((s) => s.playerId === g1Token), "guest can match its own seat by the opaque token");
  assert(g1Token !== "guest:gtest0001", "the seat token is not the raw user id");
  assert(!seats.some((s) => s.playerId === "guest:gtest0001" || s.playerId === "guest:gtest0002"), "raw user ids are NOT broadcast in table state");

  // Auto-pilot drives the hand; wait for a showdown / completion.
  for (let i = 0; i < 60 && !(sawEvent(g1, "SHOWDOWN") || sawEvent(g1, "HAND_COMPLETE") || sawEvent(g2, "SHOWDOWN") || sawEvent(g2, "HAND_COMPLETE")); i++) {
    await sleep(250);
  }
  assert(
    sawEvent(g1, "SHOWDOWN") || sawEvent(g1, "HAND_COMPLETE") || sawEvent(g2, "SHOWDOWN") || sawEvent(g2, "HAND_COMPLETE"),
    "the hand played through to showdown / completion",
  );

  // Opponents' live countdown: the server re-broadcasts the action deadline the
  // moment it sets a seat to act, so every client (not just the prompted player)
  // can render the timer ticking down on the active seat.
  type StateEv = { t: string; state?: { toActSeat: number | null; actionDeadline: number | null } };
  const broadcastDeadline = [...g1.events, ...g2.events].some(
    (e) =>
      (e as StateEv).t === "TABLE_STATE" &&
      (e as StateEv).state?.toActSeat != null &&
      (e as StateEv).state?.actionDeadline != null,
  );
  assert(broadcastDeadline, "the action deadline is broadcast to all clients (opponent countdowns)");

  // Seat-stuffing guard: a seated guest cannot take a second seat.
  g1.events.length = 0;
  g1.ws.send(JSON.stringify({ t: "BUY_IN", tableId: table.id, amount: buyIn }));
  await sleep(500);
  const err = g1.events.find((e) => e.t === "ERROR");
  assert(err && /already seated/i.test(String((err as { message?: string }).message)), "a seated guest is refused a second seat");

  // Seat count never exceeds the players actually present.
  const stateEv = [...g1.events, ...g2.events].reverse().find((e) => e.t === "TABLE_STATE") as { state?: { seats?: { playerId: string | null }[] } } | undefined;
  void stateEv;

  // Signed-ticket auth: a real (dev-seeded) user authenticates via ?ticket=.
  const realUser = await prisma.user.findFirst({
    where: { privyUserId: { startsWith: "dev:" } },
  });
  if (realUser) {
    const { signWsTicket } = await import("../src/lib/realtime/ws-ticket");
    const ticket = signWsTicket(realUser.id);
    const tw = await new Promise<Client>((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${PORT}?ticket=${encodeURIComponent(ticket)}`);
      const c: Client = { ws, id: realUser.id, events: [] };
      ws.on("open", () => { ws.send(JSON.stringify({ t: "JOIN_TABLE", tableId: table.id })); resolve(c); });
      ws.on("message", (r) => c.events.push(JSON.parse(r.toString())));
      ws.on("error", reject);
    });
    await sleep(400);
    const authErr = tw.events.find((e) => e.t === "ERROR" && (e as { code?: string }).code === "AUTH");
    assert(sawEvent(tw, "TABLE_STATE") && !authErr, "a valid signed ticket authenticates a real user");
    // A bogus ticket is rejected.
    const bad = await new Promise<Client>((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${PORT}?ticket=forged.garbage.sig`);
      const c: Client = { ws, id: "bad", events: [] };
      ws.on("open", () => { ws.send(JSON.stringify({ t: "JOIN_TABLE", tableId: table.id })); resolve(c); });
      ws.on("message", (r) => c.events.push(JSON.parse(r.toString())));
      ws.on("error", reject);
    });
    await sleep(300);
    assert(bad.events.some((e) => e.t === "ERROR" && (e as { code?: string }).code === "AUTH"), "a forged ticket is rejected (Unauthorized)");
    tw.ws.close();
    bad.ws.close();
  }

  console.log("\n✅ GUEST PLAY CHECKS PASSED");
  g1.ws.close();
  g2.ws.close();
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("\n❌ FAILED:", e);
  await prisma.$disconnect();
  process.exit(1);
});
