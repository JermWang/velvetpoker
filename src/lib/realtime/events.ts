/**
 * Realtime event contracts between the poker client and the WebSocket server.
 *
 * Wire format note: bigint chip amounts are serialized as decimal STRINGS over
 * the socket (JSON has no bigint). The server parses them back to bigint and
 * re-validates every value — the client is never trusted.
 */

import type { ActionType, Card, Street } from "@/lib/poker/types";

// ---- Client -> Server ------------------------------------------------------

export type ClientEvent =
  | { t: "JOIN_TABLE"; tableId: string; password?: string }
  | { t: "LEAVE_TABLE"; tableId: string }
  | { t: "SIT_OUT"; tableId: string; sitOut: boolean }
  | { t: "REBUY"; tableId: string; amount: string }
  | {
      t: "BUY_IN";
      tableId: string;
      amount: string;
      seatNumber?: number;
      /** Required to sit at a password-protected private table. */
      password?: string;
    }
  | {
      t: "PLAYER_ACTION";
      tableId: string;
      action: ActionType;
      amount?: string;
    }
  | { t: "SUBMIT_CLIENT_SEED"; tableId: string; seed: string }
  | { t: "SEND_CHAT"; tableId: string; message: string }
  // Optionally reveal your hole cards after winning a pot uncontested (no one
  // called). Honored only for the most recent uncontested winner.
  | { t: "SHOW_CARDS"; tableId: string }
  | { t: "REQUEST_TABLE_STATE"; tableId: string };

// ---- Server -> Client ------------------------------------------------------

export interface WireSeat {
  seat: number;
  playerId: string | null;
  displayName: string | null;
  stack: string;
  committedThisStreet: string;
  hasFolded: boolean;
  isAllIn: boolean;
  inHand: boolean;
  sittingOut: boolean;
  /**
   * The player's most recent voluntary action in the CURRENT betting round,
   * surfaced on their pod so everyone can read the prior move. Cleared when the
   * street advances (round resets) and at the start of each hand. Null = no
   * action yet this round. Blind posts are not included.
   */
  lastAction?: { action: ActionType; amount: string } | null;
  holeCards?: Card[];
}

export interface WireTableState {
  tableId: string;
  name: string;
  status: string;
  asset: string;
  smallBlind: string;
  bigBlind: string;
  street: Street | null;
  community: Card[];
  totalPot: string;
  currentBet: string;
  toActSeat: number | null;
  dealerSeat: number | null;
  actionDeadline: number | null;
  seats: WireSeat[];
  handId: string | null;
  serverSeedHash: string | null;
  /**
   * Commitment (sha256) for the NEXT hand's server seed, published a hand in
   * advance — before that hand's client seeds are submitted — so the operator
   * cannot grind the deck. Verifiable when the seed is later revealed.
   */
  nextServerSeedHash: string | null;
}

export type ServerEvent =
  | { t: "TABLE_STATE"; state: WireTableState }
  | { t: "SEAT_UPDATE"; tableId: string; seats: WireSeat[] }
  // Tells the connected player their own opaque seat token for this table, so
  // they can identify their seat without real user ids being broadcast.
  | { t: "IDENTITY"; tableId: string; playerToken: string }
  | {
      t: "HAND_STARTED";
      tableId: string;
      handId: string;
      serverSeedHash: string;
      dealerSeat: number;
    }
  | { t: "PRIVATE_CARDS"; tableId: string; handId: string; cards: Card[] }
  | { t: "COMMUNITY_CARDS"; tableId: string; street: Street; cards: Card[] }
  | {
      t: "ACTION_REQUIRED";
      tableId: string;
      seat: number;
      toCall: string;
      minRaiseTo: string;
      deadline: number;
    }
  | {
      t: "PLAYER_ACTION_APPLIED";
      tableId: string;
      seat: number;
      action: ActionType;
      amount: string;
    }
  | { t: "POT_UPDATE"; tableId: string; totalPot: string }
  | {
      t: "SHOWDOWN";
      tableId: string;
      handId: string;
      results: Array<{
        seat: number;
        playerId: string;
        amountWon: string;
        handDescription: string;
        cards: Card[];
      }>;
    }
  | { t: "HAND_COMPLETE"; tableId: string; handId: string; serverSeed: string }
  | {
      t: "LEDGER_UPDATE";
      userId: string;
      asset: string;
      available: string;
      locked: string;
    }
  | { t: "CHAT"; tableId: string; from: string; message: string; at: number }
  // A player voluntarily revealed their hole cards after an uncontested win.
  | {
      t: "SHOWN_CARDS";
      tableId: string;
      seat: number;
      playerId: string;
      displayName: string;
      cards: Card[];
    }
  | { t: "ERROR"; message: string; code?: string };

export function encode(event: ServerEvent): string {
  return JSON.stringify(event);
}

export function decode(raw: string): ClientEvent | null {
  try {
    const parsed = JSON.parse(raw) as ClientEvent;
    if (typeof parsed?.t !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}
