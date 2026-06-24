"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Card } from "@/lib/poker/types";
import { authedFetch } from "@/lib/auth/privy-token";
import type { ClientEvent, ServerEvent, WireTableState } from "./events";

export interface TableSocketState {
  connected: boolean;
  table: WireTableState | null;
  /** This client's opaque seat token (from the IDENTITY event), for self-match. */
  playerToken: string | null;
  holeCards: Card[] | null;
  /** seat -> action deadline ms, set when it's that seat's turn to act. */
  actionDeadline: number | null;
  yourTurnSeat: number | null;
  toCall: bigint;
  minRaiseTo: bigint;
  chat: Array<{ from: string; message: string; at: number }>;
  lastShowdown: Extract<ServerEvent, { t: "SHOWDOWN" }> | null;
  /** Recent completed hands at this table (newest last), for the in-game feed. */
  handHistory: HandHistoryEntry[];
  /** Cards voluntarily revealed after an uncontested win, by seat (this hand). */
  shownCards: Record<number, Card[]>;
  error: string | null;
}

export interface HandHistoryEntry {
  handId: string;
  /** Hand number parsed from the room handId ("tableId:handNumber"). */
  handNumber: number | null;
  board: Card[];
  winners: Array<{ name: string; amount: string; description: string }>;
  /** Everyone who reached showdown (revealed cards), for review. */
  shown: Array<{ name: string; cards: Card[]; description: string }>;
  at: number;
}

export interface UseTableSocketArgs {
  wsUrl: string;
  tableId: string;
  /** Query string fragment for auth, e.g. "dev=alice@x.com" or "token=...". */
  authQuery: string;
  /** Fires for every server event (e.g. to play sound effects). */
  onEvent?: (e: ServerEvent) => void;
}

export function useTableSocket({
  wsUrl,
  tableId,
  authQuery,
  onEvent,
}: UseTableSocketArgs) {
  const wsRef = useRef<WebSocket | null>(null);
  // Keep the latest callback without re-opening the socket when it changes.
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const [state, setState] = useState<TableSocketState>({
    connected: false,
    table: null,
    playerToken: null,
    holeCards: null,
    actionDeadline: null,
    yourTurnSeat: null,
    toCall: 0n,
    minRaiseTo: 0n,
    chat: [],
    lastShowdown: null,
    handHistory: [],
    shownCards: {},
    error: null,
  });

  const send = useCallback((event: ClientEvent) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  }, []);

  useEffect(() => {
    // Auto-reconnect: without this, ANY dropped socket (server redeploy, brief
    // network blip, laptop sleep) leaves a dead connection — send() silently
    // drops every message, so the table looks alive but buttons do nothing.
    // Reconnect with capped backoff until the component unmounts.
    let disposed = false;
    let attempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = async (refreshTicket: boolean) => {
      if (disposed) return;
      // The page embeds a fresh ticket at load, so the FIRST connect uses it
      // directly — never block opening the socket on a network call (a slow
      // ticket route would otherwise hang us in "Connecting…" forever). Only on
      // a RECONNECT (embedded ticket may be stale) do we fetch a fresh one, and
      // even then it's bounded so it can never hang the reconnect.
      let query = authQuery;
      if (refreshTicket && authQuery.startsWith("ticket=")) {
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 4000);
          const res = await authedFetch("/api/realtime/ticket", {
            cache: "no-store",
            signal: ctrl.signal,
          });
          clearTimeout(t);
          if (res.ok) {
            const j = (await res.json()) as { ticket?: string };
            if (j.ticket) query = `ticket=${encodeURIComponent(j.ticket)}`;
          }
        } catch {
          /* timed out or failed — fall back to the page-embedded ticket */
        }
      }
      if (disposed) return;
      const url = `${wsUrl}?${query}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        attempts = 0;
        setState((s) => ({ ...s, connected: true }));
        ws.send(JSON.stringify({ t: "JOIN_TABLE", tableId }));
        // Ask for a full baseline so a dropped/out-of-order seat frame can never
        // strand us without table state.
        ws.send(JSON.stringify({ t: "REQUEST_TABLE_STATE", tableId }));
      };
      ws.onclose = () => {
        setState((s) => ({ ...s, connected: false }));
        if (disposed) return;
        attempts += 1;
        // 0.5s, 1s, 2s, 4s, capped at 8s.
        const delay = Math.min(8000, 500 * 2 ** Math.min(attempts - 1, 4));
        reconnectTimer = setTimeout(() => connect(true), delay);
      };
      ws.onmessage = (msg) => {
        let event: ServerEvent;
        try {
          event = JSON.parse(msg.data as string) as ServerEvent;
        } catch {
          return;
        }
        onEventRef.current?.(event);
        setState((s) => reduce(s, event));
      };
    };

    connect(false); // first connect: use the embedded ticket, no blocking fetch
    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [wsUrl, tableId, authQuery]);

  return { state, send };
}

function reduce(s: TableSocketState, e: ServerEvent): TableSocketState {
  switch (e.t) {
    case "IDENTITY":
      return { ...s, playerToken: e.playerToken };
    case "TABLE_STATE":
      return { ...s, table: e.state, error: null };
    case "SEAT_UPDATE":
      return s.table
        ? { ...s, table: { ...s.table, seats: e.seats } }
        : s;
    case "PRIVATE_CARDS":
      return { ...s, holeCards: e.cards };
    case "HAND_STARTED":
      return { ...s, holeCards: null, lastShowdown: null, shownCards: {} };
    case "SHOWN_CARDS":
      return { ...s, shownCards: { ...s.shownCards, [e.seat]: e.cards } };
    case "ACTION_REQUIRED":
      return {
        ...s,
        actionDeadline: e.deadline,
        yourTurnSeat: e.seat,
        toCall: BigInt(e.toCall),
        minRaiseTo: BigInt(e.minRaiseTo),
      };
    case "PLAYER_ACTION_APPLIED":
      return { ...s, yourTurnSeat: null, actionDeadline: null };
    case "SHOWDOWN": {
      // Resolve seat -> display name from the current table so the feed reads
      // naturally (the wire uses opaque per-seat tokens, not names).
      const nameFor = (seat: number) =>
        s.table?.seats.find((x) => x.seat === seat)?.displayName ?? `Seat ${seat}`;
      const num = Number(e.handId.split(":").pop());
      const entry: HandHistoryEntry = {
        handId: e.handId,
        handNumber: Number.isFinite(num) ? num : null,
        board: s.table?.community ?? [],
        winners: e.results
          .filter((r) => BigInt(r.amountWon) > 0n)
          .map((r) => ({
            name: nameFor(r.seat),
            amount: r.amountWon,
            description: r.handDescription,
          })),
        shown: e.results
          .filter((r) => r.cards.length > 0)
          .map((r) => ({
            name: nameFor(r.seat),
            cards: r.cards,
            description: r.handDescription,
          })),
        at: Date.now(),
      };
      return {
        ...s,
        lastShowdown: e,
        handHistory: [...s.handHistory.slice(-29), entry],
      };
    }
    case "CHAT":
      return {
        ...s,
        chat: [...s.chat.slice(-50), { from: e.from, message: e.message, at: e.at }],
      };
    case "ERROR":
      return { ...s, error: e.message };
    default:
      return s;
  }
}
