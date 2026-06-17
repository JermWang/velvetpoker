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
import { verifyPrivyToken } from "@/lib/auth/privy";
import { lockBuyIn, cashOutSeat } from "@/lib/ledger/ledger";
import { TableRoom, type RoomConfig } from "./table-room";
import { attachHandPersistence } from "./persistence";
import { decode, encode, type ServerEvent } from "./events";
import { startBackgroundWorkers } from "@/lib/jobs/worker";

interface Client {
  ws: WebSocket;
  userId: string;
  displayName: string;
  tableId: string | null;
}

interface RoomEntry {
  room: TableRoom;
  clients: Set<Client>;
}

const rooms = new Map<string, RoomEntry>();

function sendTo(client: Client, event: ServerEvent): void {
  if (client.ws.readyState === client.ws.OPEN) {
    client.ws.send(encode(event));
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

async function resolveIdentity(
  url: URL,
  cookieHeader: string | undefined,
): Promise<{ userId: string; displayName: string } | null> {
  // Prefer the Privy access-token cookie sent on the WS handshake (same host,
  // so localhost cookies reach :3001), falling back to a query token.
  const cookies = parseCookies(cookieHeader);
  const token = cookies["privy-token"] ?? url.searchParams.get("token");
  const identity = await verifyPrivyToken(token);
  if (identity) {
    const user = await prisma.user.findUnique({
      where: { privyUserId: identity.privyUserId },
    });
    if (user) return { userId: user.id, displayName: user.displayName ?? "Player" };
  }
  if (!env.isProduction) {
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

async function getOrCreateRoom(tableId: string): Promise<RoomEntry | null> {
  const existing = rooms.get(tableId);
  if (existing) return existing;

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
    rakeBps: table.rakeBps,
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

  // Persist hands (Hand/HandAction/HandResult/RngProof) + route settlement
  // through the ledger.
  attachHandPersistence(room, { id: table.id, asset: table.asset });

  const entry: RoomEntry = { room, clients };
  rooms.set(tableId, entry);
  return entry;
}

async function handleEvent(client: Client, raw: string): Promise<void> {
  const event = decode(raw);
  if (!event) return sendTo(client, { t: "ERROR", message: "Malformed event" });

  const entry = await getOrCreateRoom(event.tableId);
  if (!entry) return sendTo(client, { t: "ERROR", message: "Table not found" });
  const { room } = entry;

  switch (event.t) {
    case "JOIN_TABLE": {
      client.tableId = event.tableId;
      entry.clients.add(client);
      room.setConnected(client.userId, true);
      room.sendTableState(client.userId);
      break;
    }
    case "REQUEST_TABLE_STATE":
      room.sendTableState(client.userId);
      break;
    case "BUY_IN": {
      const amount = BigInt(event.amount);
      const table = await prisma.pokerTable.findUnique({
        where: { id: event.tableId },
      });
      if (!table) break;
      try {
        // Lock funds available -> table-locked before seating.
        await lockBuyIn({
          userId: client.userId,
          asset: table.asset,
          amount,
          tableId: table.id,
          correlationId: `buyin:${client.userId}:${Date.now()}`,
        });
      } catch (err) {
        sendTo(client, {
          t: "ERROR",
          message: err instanceof Error ? err.message : "Buy-in failed",
        });
        break;
      }
      const seatNumber = event.seatNumber ?? nextFreeSeat(room, table.maxSeats);
      if (seatNumber === null) {
        sendTo(client, { t: "ERROR", message: "No free seat" });
        break;
      }
      room.sit({
        playerId: client.userId,
        displayName: client.displayName,
        seatNumber,
        stack: amount,
      });
      break;
    }
    case "PLAYER_ACTION": {
      const amount = event.amount ? BigInt(event.amount) : undefined;
      room.handleAction(client.userId, event.action, amount);
      break;
    }
    case "SIT_OUT":
      room.setSitOut(client.userId, event.sitOut);
      break;
    case "SUBMIT_CLIENT_SEED":
      room.submitClientSeed(client.userId, event.seed);
      break;
    case "LEAVE_TABLE": {
      const returned = room.leave(client.userId);
      const table = await prisma.pokerTable.findUnique({
        where: { id: event.tableId },
      });
      if (table && returned > 0n) {
        try {
          await cashOutSeat({
            userId: client.userId,
            asset: table.asset,
            amount: returned,
            tableId: table.id,
            correlationId: `cashout:${client.userId}:${Date.now()}`,
          });
        } catch (err) {
          console.error("[ws] cashOutSeat failed", err);
        }
      }
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

function nextFreeSeat(room: TableRoom, maxSeats: number): number | null {
  const taken = new Set(room.buildTableState().seats.map((s) => s.seat));
  for (let i = 0; i < maxSeats; i++) if (!taken.has(i)) return i;
  return null;
}

export function startServer(
  // Hosts (Railway, Render, etc.) inject a dynamic PORT for the service.
  port = process.env.PORT ? Number(process.env.PORT) : env.wsPort,
): WebSocketServer {
  // Wrap the WS server in a plain HTTP server so the host's healthcheck (an
  // HTTP GET) succeeds and the WebSocket upgrade shares the same bound port.
  const httpServer = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("velvet-poker-ws ok");
  });
  const wss = new WebSocketServer({ server: httpServer });
  httpServer.listen(port, "0.0.0.0", () => {
    console.log(`[ws] Velvet Poker realtime server listening on :${port}`);
  });

  wss.on("connection", async (ws, req) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    const identity = await resolveIdentity(url, req.headers.cookie);
    if (!identity) {
      ws.send(encode({ t: "ERROR", message: "Unauthorized", code: "AUTH" }));
      ws.close();
      return;
    }
    const client: Client = {
      ws,
      userId: identity.userId,
      displayName: identity.displayName,
      tableId: null,
    };

    ws.on("message", (data) => {
      void handleEvent(client, data.toString());
    });
    ws.on("close", () => {
      if (client.tableId) {
        const entry = rooms.get(client.tableId);
        if (entry) {
          entry.room.setConnected(client.userId, false);
          entry.clients.delete(client);
        }
      }
    });
  });

  return wss;
}

// Allow running directly: `tsx src/lib/realtime/server.ts`
if (process.argv[1] && process.argv[1].includes("server")) {
  startServer();
  // Co-locate the on-chain background workers (deposit monitor, withdrawal
  // processor, reconciliation) in this always-on process. Set
  // RUN_BACKGROUND_WORKERS=false to run them in a separate service instead.
  if (process.env.RUN_BACKGROUND_WORKERS !== "false") {
    startBackgroundWorkers();
  }
}
