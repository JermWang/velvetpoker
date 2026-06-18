"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Card } from "@/lib/poker/types";
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
  error: string | null;
}

export interface UseTableSocketArgs {
  wsUrl: string;
  tableId: string;
  /** Query string fragment for auth, e.g. "dev=alice@x.com" or "token=...". */
  authQuery: string;
}

export function useTableSocket({ wsUrl, tableId, authQuery }: UseTableSocketArgs) {
  const wsRef = useRef<WebSocket | null>(null);
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
    error: null,
  });

  const send = useCallback((event: ClientEvent) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  }, []);

  useEffect(() => {
    const url = `${wsUrl}?${authQuery}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setState((s) => ({ ...s, connected: true }));
      ws.send(JSON.stringify({ t: "JOIN_TABLE", tableId }));
    };
    ws.onclose = () => setState((s) => ({ ...s, connected: false }));
    ws.onmessage = (msg) => {
      let event: ServerEvent;
      try {
        event = JSON.parse(msg.data as string) as ServerEvent;
      } catch {
        return;
      }
      setState((s) => reduce(s, event));
    };

    return () => ws.close();
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
      return { ...s, holeCards: null, lastShowdown: null };
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
    case "SHOWDOWN":
      return { ...s, lastShowdown: e };
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
