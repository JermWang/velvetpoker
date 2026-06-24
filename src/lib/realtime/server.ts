/**
 * Standalone realtime poker WebSocket server (`npm run ws`).
 *
 * Runs as its own Node process alongside Next.js. It owns authoritative table
 * rooms, routes ClientEvents, and persists money movements through the ledger
 * services. Next.js (HTTP/SSR) and this process share Postgres + Redis.
 *
 * Auth: a Privy access token is passed as `?token=` (verified server-side). In
 * development, when Privy is not configured, `?dev=<email>` is accepted — this
 * mirrors the dev session fallback in src/lib/auth/session.ts.
 */

import http from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/env";
import { lockBuyIn, cashOutSeat } from "@/lib/ledger/ledger";
import { canPlayRealMoney } from "@/lib/compliance/gates";
import { verifyPassword } from "@/lib/crypto";
import { formatAmount } from "@/lib/ledger/money";
import { TableRoom, type RoomConfig } from "./table-room";
import { attachHandPersistence, reconstructSeatedStacks } from "./persistence";
import { decode, encode, type ServerEvent } from "./events";
import { verifyWsTicket } from "./ws-ticket";
import { startBackgroundWorkers } from "@/lib/jobs/worker";
import { sendOpsAlert } from "@/lib/risk/alert";
import { recordOpsFailure } from "@/lib/risk/risk-events";

interface Client {
  ws: WebSocket;
  /** Null for unauthenticated spectators; a `guest:<id>` for free-play guests. */
  userId: string | null;
  displayName: string;
  tableId: string | null;
  isSpectator: boolean;
  /** Unauthenticated free-play guest — may sit ONLY at demo tables, no ledger. */
  isGuest: boolean;
}

interface RoomEntry {
  room: TableRoom;
  clients: Set<Client>;
  /** Free-play demo table: free chips, no ledger, guests allowed. */
  isDemo: boolean;
}

const rooms = new Map<string, RoomEntry>();

// Per-connection message rate limit (token bucket).
const WS_MSG_BURST = 30;
const WS_MSG_REFILL_PER_SEC = 15;

function sendTo(client: Client, event: ServerEvent): void {
  if (client.ws.readyState === client.ws.OPEN) {
    client.ws.send(encode(event));
  }
}

async function resolveIdentity(
  url: URL,
): Promise<{ userId: string; displayName: string } | null> {
  // Authenticated players present a short-lived, signed ticket minted by the web
  // app (which holds the verified Privy session). The raw Privy token never
  // touches the WS URL.
  const ticket = url.searchParams.get("ticket");
  if (ticket) {
    const userId = verifyWsTicket(ticket);
    if (userId) {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (user) return { userId: user.id, displayName: user.displayName ?? "Player" };
    }
  }
  // Dev-only impersonation fallback. Hard-gated to environments where Privy is
  // NOT configured (true local dev) so it can never be reached in production,
  // regardless of whether NODE_ENV is set on the host.
  const privyConfigured = Boolean(env.privyAppId && env.privyAppSecret);
  if (!env.isProduction && !privyConfigured) {
    const devEmail = url.searchParams.get("dev");
    if (devEmail) {
      const user = await prisma.user.findUnique({
        where: { privyUserId: `dev:${devEmail.toLowerCase()}` },
      });
      if (user) {
        return { userId: user.id, displayName: user.displayName ?? devEmail };
      }
    }
  }
  return null;
}

// In-flight room creations, so two clients joining the same table at the same
// time share ONE room instead of racing to create two (which would split the
// players across rooms and the hand would never start).
const roomCreation = new Map<string, Promise<RoomEntry | null>>();

async function getOrCreateRoom(tableId: string): Promise<RoomEntry | null> {
  const existing = rooms.get(tableId);
  if (existing) return existing;

  let pending = roomCreation.get(tableId);
  if (!pending) {
    pending = createRoom(tableId);
    roomCreation.set(tableId, pending);
    void pending.finally(() => roomCreation.delete(tableId));
  }
  return pending;
}

async function createRoom(tableId: string): Promise<RoomEntry | null> {
  const table = await prisma.pokerTable.findUnique({ where: { id: tableId } });
  if (!table) return null;

  const config: RoomConfig = {
    tableId: table.id,
    name: table.name,
    asset: table.asset,
    smallBlind: table.smallBlind,
    bigBlind: table.bigBlind,
    maxSeats: table.maxSeats,
    actionTimeoutSeconds: table.actionTimeoutSeconds,
    // Demo tables take no rake and never touch the ledger.
    rakeBps: table.isDemo ? 0 : table.rakeBps,
    isDemo: table.isDemo,
  };

  const clients = new Set<Client>();
  const room = new TableRoom(config, {
    send: (playerId, event) => {
      for (const c of clients) if (c.userId === playerId) sendTo(c, event);
    },
    broadcast: (event) => {
      for (const c of clients) sendTo(c, event);
    },
  });

  // Real-money tables persist hands + route settlement through the ledger.
  // Demo tables run purely in memory: no ledger, no DB writes, free chips.
  if (!table.isDemo) {
    attachHandPersistence(room, {
      id: table.id,
      asset: table.asset,
      isPrivate: table.visibility === "PRIVATE",
    });

    // CRASH RECOVERY: if this process restarted with players still holding funds
    // locked at this table, rebuild their seats from the ledger so the money is
    // never stranded. Stacks are the authoritative net USER_TABLE_LOCKED per
    // player; restored players reconnect into their seat (JOIN_TABLE). Any hand
    // interrupted by the crash is voided (the ledger never settled it).
    try {
      const restored = await reconstructSeatedStacks(table.id, table.asset);
      if (restored.length > 0) {
        room.restoreSeats(restored);
        console.log(
          `[ws] restored ${restored.length} seat(s) from ledger for table ${table.id}`,
        );
      }
    } catch (e) {
      console.error("[ws] seat restore failed", e);
      void recordOpsFailure(
        `seat restore from ledger FAILED for table ${table.id}: ${String(e)} — players with locked funds may not see their seat until this is resolved.`,
        { kind: "seat_restore_failed", tableId: table.id },
      );
    }
  }

  const entry: RoomEntry = { room, clients, isDemo: table.isDemo };
  rooms.set(tableId, entry);
  return entry;
}

async function handleEvent(client: Client, raw: string): Promise<void> {
  const event = decode(raw);
  if (!event) return sendTo(client, { t: "ERROR", message: "Malformed event" });

  const entry = await getOrCreateRoom(event.tableId);
  if (!entry) return sendTo(client, { t: "ERROR", message: "Table not found" });
  const { room } = entry;

  // Spectators are read-only: they receive public broadcasts (felt, bets, pot,
  // showdown) but can never sit, act, or chat, and never receive hole cards
  // (those are delivered by playerId, which a null-userId spectator can't match).
  if (client.isSpectator) {
    switch (event.t) {
      case "JOIN_TABLE": {
        const table = await prisma.pokerTable.findUnique({
          where: { id: event.tableId },
        });
        if (!table?.spectatorsAllowed) {
          return sendTo(client, {
            t: "ERROR",
            message: "Spectating is not allowed at this table",
          });
        }
        client.tableId = event.tableId;
        entry.clients.add(client);
        sendTo(client, { t: "TABLE_STATE", state: room.buildTableState() });
        break;
      }
      case "REQUEST_TABLE_STATE":
        sendTo(client, { t: "TABLE_STATE", state: room.buildTableState() });
        break;
      default:
        sendTo(client, {
          t: "ERROR",
          message: "Connect a wallet to take a seat or chat",
        });
    }
    return;
  }

  // Authenticated player or free-play guest from here on (spectators returned
  // above). Guests carry a `guest:<id>` and may only act at demo tables.
  const userId = client.userId;
  if (userId == null) return;
  if (client.isGuest && !entry.isDemo) {
    return sendTo(client, {
      t: "ERROR",
      message: "Connect a wallet to play real-money tables",
    });
  }

  switch (event.t) {
    case "JOIN_TABLE": {
      client.tableId = event.tableId;
      entry.clients.add(client);
      room.setConnected(userId, true);
      // Tell the client its opaque seat token so it can recognize its own seat
      // (the wire never carries real user ids).
      sendTo(client, {
        t: "IDENTITY",
        tableId: event.tableId,
        playerToken: room.identityToken(userId),
      });
      room.sendTableState(userId);
      // Reconnect mid-hand: re-send this player's hole cards + turn prompt.
      room.resyncPlayer(userId);
      break;
    }
    case "REQUEST_TABLE_STATE":
      room.sendTableState(userId);
      break;
    case "BUY_IN": {
      const amount = BigInt(event.amount);
      const table = await prisma.pokerTable.findUnique({
        where: { id: event.tableId },
      });
      if (!table) break;

      // One seat per player. Reject a second buy-in BEFORE locking any funds.
      if (room.hasPlayer(userId)) {
        sendTo(client, { t: "ERROR", message: "You're already seated at this table" });
        break;
      }

      // Demo tables seat with free chips and never touch the ledger; the stack
      // is clamped to the table's configured buy-in range.
      if (entry.isDemo) {
        const stack =
          amount < table.minBuyIn
            ? table.minBuyIn
            : amount > table.maxBuyIn
              ? table.maxBuyIn
              : amount;
        // Full table? Reclaim a busted seat to make room (kick if there's a
        // queue); otherwise there's genuinely no seat.
        const seatNumber =
          event.seatNumber ?? room.firstFreeSeat() ?? room.evictOneBustedSeat();
        if (seatNumber === null) {
          sendTo(client, { t: "ERROR", message: "No free seat" });
          break;
        }
        room.sit({
          playerId: userId,
          displayName: client.displayName,
          seatNumber,
          stack,
        });
        break;
      }

      // ---- Server-authoritative gates (the page checks are UX only) ----------
      // The table must be open for buy-ins.
      if (table.status !== "WAITING" && table.status !== "ACTIVE") {
        sendTo(client, { t: "ERROR", message: "This table isn't open for buy-ins" });
        break;
      }
      // Compliance / responsible-gaming (geo, age, KYC, self-exclusion, status).
      const buyInUser = await prisma.user.findUnique({ where: { id: userId } });
      if (!buyInUser || !canPlayRealMoney(buyInUser)) {
        sendTo(client, {
          t: "ERROR",
          message: "Your account can't join real-money play right now. See Account.",
        });
        break;
      }
      // Private-table password.
      if (table.visibility === "PRIVATE" && table.passwordHash) {
        if (!event.password || !verifyPassword(event.password, table.passwordHash)) {
          sendTo(client, { t: "ERROR", message: "Incorrect table password" });
          break;
        }
      }
      // Buy-in must be within the table's configured range.
      if (amount < table.minBuyIn || amount > table.maxBuyIn) {
        sendTo(client, {
          t: "ERROR",
          message: `Buy-in must be between ${formatAmount(table.asset, table.minBuyIn)} and ${formatAmount(table.asset, table.maxBuyIn)} ${table.asset}`,
        });
        break;
      }

      try {
        // Lock funds available -> table-locked before seating.
        await lockBuyIn({
          userId,
          asset: table.asset,
          amount,
          tableId: table.id,
          correlationId: `buyin:${userId}:${Date.now()}`,
        });
      } catch (err) {
        sendTo(client, {
          t: "ERROR",
          message: err instanceof Error ? err.message : "Buy-in failed",
        });
        break;
      }
      // Seat the player. If seating fails for ANY reason (full table, or a race
      // where a concurrent BUY_IN took the seat / already seated us while we
      // awaited the ledger), the funds we just locked have no seat backing them —
      // refund them immediately so they are never stranded in table-locked.
      // Full table? Reclaim a busted seat to make room (kick if there's a queue);
      // otherwise the funds we locked have no seat and are refunded below.
      const seatNumber =
        event.seatNumber ?? room.firstFreeSeat() ?? room.evictOneBustedSeat();
      const seated =
        seatNumber !== null &&
        room.sit({
          playerId: userId,
          displayName: client.displayName,
          seatNumber,
          stack: amount,
        });
      if (!seated) {
        try {
          await cashOutSeat({
            userId,
            asset: table.asset,
            amount,
            tableId: table.id,
            correlationId: `buyin-refund:${userId}:${Date.now()}`,
          });
        } catch (refundErr) {
          console.error("[ws] buy-in refund failed", refundErr);
          void recordOpsFailure(
            `buy-in refund FAILED for user ${userId} table ${table.id} amount ${amount}: ${String(
              refundErr,
            )} — funds may be locked with no seat; reconcile.`,
            { kind: "buyin_refund_failed", userId, tableId: table.id },
          );
        }
        // sit() already sent a specific ERROR for the race cases; only the
        // full-table case needs a message here.
        if (seatNumber === null) {
          sendTo(client, { t: "ERROR", message: "No free seat" });
        }
        break;
      }
      break;
    }
    case "PLAYER_ACTION": {
      const amount = event.amount ? BigInt(event.amount) : undefined;
      room.handleAction(userId, event.action, amount);
      break;
    }
    case "SIT_OUT":
      room.setSitOut(userId, event.sitOut);
      break;
    case "REBUY": {
      // Top up chips between hands. Demo = free chips; real = lock more funds.
      if (!room.hasPlayer(userId)) {
        sendTo(client, { t: "ERROR", message: "Take a seat first" });
        break;
      }
      if (room.isInActiveHand(userId)) {
        sendTo(client, { t: "ERROR", message: "You can rebuy once the hand finishes" });
        break;
      }
      const table = await prisma.pokerTable.findUnique({
        where: { id: event.tableId },
      });
      if (!table) break;
      // Clamp so the resulting stack never exceeds the table's max buy-in.
      const current = room.stackOf(userId);
      const room2max = table.maxBuyIn - current;
      let amount = BigInt(event.amount);
      if (amount > room2max) amount = room2max;
      if (amount <= 0n) {
        sendTo(client, { t: "ERROR", message: "You're already at the max stack" });
        break;
      }
      if (entry.isDemo) {
        room.topUp(userId, amount);
        room.setSitOut(userId, false); // re-activate a busted player
        break;
      }
      try {
        await lockBuyIn({
          userId,
          asset: table.asset,
          amount,
          tableId: table.id,
          correlationId: `rebuy:${userId}:${Date.now()}`,
        });
      } catch (err) {
        sendTo(client, {
          t: "ERROR",
          message: err instanceof Error ? err.message : "Rebuy failed",
        });
        break;
      }
      room.topUp(userId, amount);
      room.setSitOut(userId, false);
      break;
    }
    case "SUBMIT_CLIENT_SEED":
      room.submitClientSeed(userId, event.seed);
      break;
    case "SHOW_CARDS":
      // Optional reveal after an uncontested win (no-op unless the caller is the
      // most recent uncontested winner).
      room.showCards(userId);
      break;
    case "LEAVE_TABLE": {
      // You can't pick chips up out of a live pot. Make the player finish the
      // current hand before leaving — this also prevents a cash-out of the
      // stale pre-hand stack (which would create chips).
      if (room.isInActiveHand(userId)) {
        sendTo(client, {
          t: "ERROR",
          message: "You can leave once the current hand finishes",
        });
        break;
      }
      // Demo chips are free — just vacate the seat, nothing to settle.
      if (entry.isDemo) {
        room.leave(userId);
        entry.clients.delete(client);
        break;
      }

      // Real money: settle the stack back to the ledger BEFORE removing the seat,
      // so a transient ledger failure can never destroy the player's funds (the
      // old order deleted the seat first, stranding the stack in table-locked on
      // any error). Mark them sitting-out while we await so they can't be dealt
      // into a new hand mid-settlement; restore on failure.
      const returned = room.stackOf(userId);
      if (returned > 0n) {
        const table = await prisma.pokerTable.findUnique({
          where: { id: event.tableId },
        });
        if (!table) {
          sendTo(client, { t: "ERROR", message: "Couldn't cash out right now — please try again." });
          break;
        }
        room.setSitOut(userId, true);
        try {
          await cashOutSeat({
            userId,
            asset: table.asset,
            amount: returned,
            tableId: table.id,
            correlationId: `cashout:${userId}:${Date.now()}`,
          });
        } catch (err) {
          console.error("[ws] cashOutSeat failed", err);
          void recordOpsFailure(
            `cash-out FAILED for user ${userId} table ${table.id} amount ${returned}: ${String(
              err,
            )} — funds remain locked at the table; player asked to retry.`,
            { kind: "cashout_failed", userId, tableId: table.id },
          );
          // Funds are still safely locked and the seat is intact — restore the
          // player so nothing is lost, and let them retry leaving.
          room.setSitOut(userId, false);
          sendTo(client, { t: "ERROR", message: "Couldn't cash out right now — please try again." });
          break;
        }
      }
      room.leave(userId);
      entry.clients.delete(client);
      break;
    }
    case "SEND_CHAT":
      entry.room.broadcastTableState(); // ensure state fresh
      for (const c of entry.clients) {
        sendTo(c, {
          t: "CHAT",
          tableId: event.tableId,
          from: client.displayName,
          message: event.message.slice(0, 280),
          at: Date.now(),
        });
      }
      break;
  }
}

export function startServer(
  // Hosts (Railway, Render, etc.) inject a dynamic PORT for the service.
  port = process.env.PORT ? Number(process.env.PORT) : env.wsPort,
): WebSocketServer {
  // Wrap the WS server in a plain HTTP server so the host's healthcheck (an
  // HTTP GET) succeeds and the WebSocket upgrade shares the same bound port.
  const httpServer = http.createServer((req, res) => {
    // Live seat occupancy for the lobby. Demo tables keep their seats only in
    // this process's memory (no DB rows), so the lobby can't get live counts any
    // other way. Public, non-sensitive counts → permissive CORS so the web app
    // (a different origin) can poll it directly.
    const path = (req.url ?? "/").split("?")[0];
    if (path === "/occupancy") {
      const out: Record<string, number> = {};
      for (const [tableId, entry] of rooms) {
        out[tableId] = entry.room.occupiedSeatCount();
      }
      res.writeHead(200, {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify(out));
      return;
    }
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("velvet-poker-ws ok");
  });
  const wss = new WebSocketServer({ server: httpServer });
  httpServer.listen(port, "0.0.0.0", () => {
    console.log(`[ws] Velvet Poker realtime server listening on :${port}`);
  });

  wss.on("connection", async (ws, req) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    // Buffer any messages that arrive while we authenticate (resolveIdentity
    // does a DB lookup): clients send JOIN_TABLE immediately on open, and
    // without this the JOIN would be dropped because no message listener is
    // attached yet — leaving the player with no table state.
    const early: string[] = [];
    const earlyHandler = (data: unknown) => early.push(String(data));
    ws.on("message", earlyHandler);

    const identity = await resolveIdentity(url);
    // Connection modes (in priority order):
    //  - authenticated user (Privy token / dev cookie)
    //  - free-play guest (?guest=<id>) — may sit only at demo tables
    //  - read-only spectator (?spectate=1)
    const wantsSpectate = url.searchParams.get("spectate") === "1";
    const guestParam = url.searchParams.get("guest");
    // Namespace guest ids with a "guest:" prefix so a guest can never present an
    // id equal to a real user's (which would let them receive that user's
    // hole cards at a demo table). The client uses the same prefixed form as its
    // `youUserId`. Guest privileges are enforced by the isGuest flag.
    const guestId =
      guestParam && /^[A-Za-z0-9_-]{1,40}$/.test(guestParam)
        ? `guest:${guestParam}`
        : null;

    if (!identity && !guestId && !wantsSpectate) {
      ws.off("message", earlyHandler);
      ws.send(encode({ t: "ERROR", message: "Unauthorized", code: "AUTH" }));
      ws.close();
      return;
    }

    let client: Client;
    if (identity) {
      client = {
        ws,
        userId: identity.userId,
        displayName: identity.displayName,
        tableId: null,
        isSpectator: false,
        isGuest: false,
      };
    } else if (guestId) {
      client = {
        ws,
        userId: guestId,
        displayName: `Guest ${guestId.slice(-4)}`,
        tableId: null,
        isSpectator: false,
        isGuest: true,
      };
    } else {
      client = {
        ws,
        userId: null,
        displayName: "Spectator",
        tableId: null,
        isSpectator: true,
        isGuest: false,
      };
    }

    // Per-connection flood protection (token bucket). Normal play sends a
    // handful of messages per action; a flood is silently dropped.
    const rl = { tokens: WS_MSG_BURST, last: Date.now() };
    const accept = (raw: string): void => {
      const now = Date.now();
      rl.tokens = Math.min(
        WS_MSG_BURST,
        rl.tokens + ((now - rl.last) / 1000) * WS_MSG_REFILL_PER_SEC,
      );
      rl.last = now;
      if (rl.tokens < 1) return; // throttled — drop
      rl.tokens -= 1;
      // A thrown handler must never become an unhandled rejection (which would
      // crash this process and the co-located money workers). Log + isolate it.
      handleEvent(client, raw).catch((e) => {
        console.error("[ws] handler error", e);
      });
    };

    // Swap the buffering handler for the real one, then replay anything that
    // arrived during authentication (e.g. the initial JOIN_TABLE).
    ws.off("message", earlyHandler);
    ws.on("message", (data) => accept(String(data)));
    for (const raw of early) accept(raw);
    ws.on("close", () => {
      if (!client.tableId) return;
      const entry = rooms.get(client.tableId);
      if (!entry) return;
      entry.clients.delete(client);
      if (!client.userId) return;
      // A fast refresh can open the new socket BEFORE this one closes — if the
      // user still has another live socket here, they never actually left.
      const stillHere = [...entry.clients].some(
        (c) => c.userId === client.userId,
      );
      if (stillHere) return;
      if (client.isGuest || entry.isDemo) {
        // Free play: keep the seat briefly so an accidental refresh reconnects
        // into the same hand; freed automatically if they don't return.
        entry.room.markDisconnected(client.userId);
      } else {
        // Real-money seats stay (marked offline) so the player can reconnect;
        // their funds remain locked until they leave.
        entry.room.setConnected(client.userId, false);
      }
    });
  });

  return wss;
}

// Allow running directly: `tsx src/lib/realtime/server.ts`
if (process.argv[1] && process.argv[1].includes("server")) {
  // Crash visibility: this process holds live tables AND the on-chain money
  // workers, so a silent death must be loud. A rejected promise we missed is
  // logged + alerted but kept alive (don't tear down active tables for one bad
  // path). A truly uncaught exception leaves state unknown — alert, then exit so
  // Railway restarts clean.
  process.on("unhandledRejection", (reason) => {
    console.error("[ws] unhandledRejection", reason);
    sendOpsAlert(`ws unhandledRejection: ${String(reason)}`);
  });
  process.on("uncaughtException", (err) => {
    console.error("[ws] uncaughtException", err);
    sendOpsAlert(`ws uncaughtException: ${err?.message ?? String(err)} — restarting`);
    setTimeout(() => process.exit(1), 1000);
  });

  startServer();
  // Co-locate the on-chain background workers (deposit monitor, withdrawal
  // processor, reconciliation) in this always-on process. Set
  // RUN_BACKGROUND_WORKERS=false to run them in a separate service instead.
  if (process.env.RUN_BACKGROUND_WORKERS !== "false") {
    startBackgroundWorkers();
  }
}
