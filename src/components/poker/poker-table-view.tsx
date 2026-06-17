"use client";

import { useMemo, useState } from "react";
import { useTableSocket } from "@/lib/realtime/use-table-socket";
import { formatAmount, parseAmount } from "@/lib/ledger/money";
import type { Asset } from "@/lib/ledger/money";
import type { ActionType } from "@/lib/poker/types";
import { Seat } from "./seat";
import { Card3D } from "./card-3d";
import { ActionBar } from "./action-bar";
import { BuyInPanel } from "./buy-in-panel";
import { VerifyHandDrawer } from "./verify-hand-drawer";
import { Button } from "@/components/ui/button";
import { ConnectButton } from "@/components/auth/connect-button";

export interface PokerTableViewProps {
  tableId: string;
  tableName: string;
  asset: Asset;
  minBuyIn: string;
  maxBuyIn: string;
  wsUrl: string;
  authQuery: string;
  /** Null when the viewer is an unauthenticated spectator. */
  youUserId: string | null;
  /** Free-play demo table — free chips, no real money. */
  demo?: boolean;
  /** Guest free-play: generate an ephemeral id and connect as a guest. */
  guestMode?: boolean;
}

export function PokerTableView(props: PokerTableViewProps) {
  // Guests get a stable ephemeral id for the session; it's the playerId the ws
  // seats them under (demo tables only) and what we match "your seat" against.
  const [guestId] = useState<string | null>(() =>
    props.guestMode
      ? `g${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`
      : null,
  );
  const youUserId = props.guestMode ? guestId : props.youUserId;
  const authQuery =
    props.guestMode && guestId ? `guest=${guestId}` : props.authQuery;

  const { state, send } = useTableSocket({
    wsUrl: props.wsUrl,
    tableId: props.tableId,
    authQuery,
  });
  const [chatInput, setChatInput] = useState("");

  const isSpectator = youUserId == null;
  const table = state.table;
  const yourSeat = useMemo(
    () =>
      youUserId == null
        ? null
        : (table?.seats.find((s) => s.playerId === youUserId) ?? null),
    [table, youUserId],
  );
  const seated = !!yourSeat;
  const isYourTurn =
    yourSeat != null && state.yourTurnSeat === yourSeat.seat;

  function act(action: ActionType, amount?: bigint) {
    send({
      t: "PLAYER_ACTION",
      tableId: props.tableId,
      action,
      amount: amount?.toString(),
    });
  }

  function buyIn(amount: string) {
    try {
      const lamports = parseAmount(props.asset, amount);
      send({ t: "BUY_IN", tableId: props.tableId, amount: lamports.toString() });
    } catch {
      /* ignore parse errors; the field guides format */
    }
  }

  // Demo tables use free chips; real tables are labeled in their asset.
  const unit = props.demo ? "chips" : props.asset;

  return (
    <div className="space-y-6">
      {props.demo && (
        <div className="rounded-xl border border-velvet/25 bg-velvet/[0.04] px-4 py-2.5 text-center text-sm text-velvet/90">
          Free play — demo chips, no wallet or deposit needed. Nothing here is
          real money.
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-ivory">{props.tableName}</h1>
          <p className="text-xs text-ash">
            {table
              ? `${formatAmount(props.asset, BigInt(table.smallBlind))} / ${formatAmount(
                  props.asset,
                  BigInt(table.bigBlind),
                )} ${unit} · ${table.status}`
              : state.connected
                ? "Loading table…"
                : "Connecting…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isSpectator && (
            <span className="rounded-full border border-velvet/30 bg-velvet/5 px-2.5 py-1 text-[11px] uppercase tracking-[0.16em] text-velvet/90">
              Spectating
            </span>
          )}
          <span
            className={`h-2 w-2 rounded-full ${
              state.connected ? "bg-emerald-400" : "bg-amber-400 animate-pulse-soft"
            }`}
          />
          <VerifyHandDrawer handId={table?.handId ?? null} />
          {seated && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => send({ t: "LEAVE_TABLE", tableId: props.tableId })}
            >
              Leave
            </Button>
          )}
        </div>
      </div>

      {/* Felt */}
      <div className="relative overflow-hidden rounded-[2.5rem] border border-felt-light/30 bg-felt-radial p-8 shadow-elevated">
        <div className="flex min-h-[180px] flex-col items-center justify-center gap-4">
          <div className="flex items-center gap-3">
            {table && table.community.length > 0 ? (
              table.community.map((c) => (
                <Card3D key={c} card={c} size="lg" />
              ))
            ) : (
              <p className="text-sm text-ivory/50">
                {table?.handId ? "Awaiting the flop" : "Waiting for the next hand"}
              </p>
            )}
          </div>
          {table && (
            <div className="rounded-full border border-velvet/30 bg-charcoal-900/40 px-4 py-1.5">
              <span className="text-xs text-ash">Pot </span>
              <span className="font-mono text-velvet">
                {formatAmount(props.asset, BigInt(table.totalPot))} {unit}
              </span>
            </div>
          )}
        </div>

        {/* Seats */}
        <div className="mt-8 flex flex-wrap items-stretch justify-center gap-3">
          {table?.seats.map((s) => (
            <Seat
              key={s.seat}
              seat={s}
              asset={props.asset}
              isDealer={table.dealerSeat === s.seat}
              isToAct={table.toActSeat === s.seat}
              isYou={s.playerId === youUserId}
              holeCards={s.playerId === youUserId ? state.holeCards : null}
            />
          ))}
        </div>
      </div>

      {/* Your hand — the one place we lean into the 3D card for emphasis. */}
      {seated && state.holeCards && state.holeCards.length > 0 && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-eyebrow">Your hand</p>
          <div className="flex items-end gap-4">
            {state.holeCards.map((c) => (
              <Card3D key={c} card={c} size="lg" tilt />
            ))}
          </div>
        </div>
      )}

      {/* Showdown summary */}
      {state.lastShowdown && (
        <div className="card-surface p-4">
          <p className="mb-2 text-xs text-ash">Showdown</p>
          <ul className="space-y-1 text-sm">
            {state.lastShowdown.results
              .filter((r) => BigInt(r.amountWon) > 0n)
              .map((r) => (
                <li key={r.seat} className="text-ivory">
                  Seat {r.seat + 1} wins {formatAmount(props.asset, BigInt(r.amountWon))}{" "}
                  {unit} — {r.handDescription}
                </li>
              ))}
          </ul>
        </div>
      )}

      {/* Action / buy-in */}
      {isSpectator ? (
        <div className="card-surface flex flex-col items-center gap-3 p-6 text-center">
          <p className="text-sm text-ash">
            You&apos;re spectating. Connect your wallet to take a seat and play.
          </p>
          <ConnectButton label="Connect wallet to take a seat" />
        </div>
      ) : !seated ? (
        <BuyInPanel
          asset={props.asset}
          minBuyIn={BigInt(props.minBuyIn)}
          maxBuyIn={BigInt(props.maxBuyIn)}
          onBuyIn={buyIn}
          demo={props.demo}
        />
      ) : isYourTurn && table ? (
        <ActionBar
          asset={props.asset}
          toCall={state.toCall}
          minRaiseTo={state.minRaiseTo}
          currentBet={BigInt(table.currentBet)}
          yourStack={BigInt(yourSeat!.stack)}
          yourCommitted={BigInt(yourSeat!.committedThisStreet)}
          onAction={act}
        />
      ) : (
        <p className="text-center text-sm text-ash">
          {table?.toActSeat != null
            ? `Waiting on seat ${table.toActSeat + 1}…`
            : "Waiting for the next hand…"}
        </p>
      )}

      {state.error && (
        <p className="text-center text-sm text-red-300">{state.error}</p>
      )}

      {/* Chat */}
      <div className="card-surface p-4">
        <div className="mb-3 max-h-32 space-y-1 overflow-y-auto text-sm">
          {state.chat.length === 0 ? (
            <p className="text-xs text-ash/60">Table chat</p>
          ) : (
            state.chat.map((m, i) => (
              <p key={i} className="text-ash">
                <span className="text-ivory">{m.from}:</span> {m.message}
              </p>
            ))
          )}
        </div>
        {isSpectator ? (
          <p className="text-xs text-ash/60">
            Connect your wallet to join the conversation.
          </p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!chatInput.trim()) return;
              send({ t: "SEND_CHAT", tableId: props.tableId, message: chatInput });
              setChatInput("");
            }}
            className="flex gap-2"
          >
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Say something…"
              className="h-9 flex-1 rounded-lg border border-white/10 bg-charcoal-900/60 px-3 text-sm text-ivory placeholder:text-ash/50 focus:outline-none"
            />
            <Button size="sm" variant="secondary" type="submit">
              Send
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
