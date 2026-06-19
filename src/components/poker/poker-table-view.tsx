"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const authQuery =
    props.guestMode && guestId ? `guest=${guestId}` : props.authQuery;

  const { state, send } = useTableSocket({
    wsUrl: props.wsUrl,
    tableId: props.tableId,
    authQuery,
  });
  const [chatInput, setChatInput] = useState("");
  const [chatOpen, setChatOpen] = useState(false);

  // Spectator status is fixed by the connection mode; seat identity comes from
  // the opaque per-table token the server sends (real ids are never broadcast).
  const isSpectator = !props.guestMode && props.youUserId == null;
  const youToken = state.playerToken;
  const table = state.table;
  const yourSeat = useMemo(
    () =>
      youToken == null
        ? null
        : (table?.seats.find((s) => s.playerId === youToken) ?? null),
    [table, youToken],
  );
  const seated = !!yourSeat;
  const isYourTurn =
    yourSeat != null && state.yourTurnSeat === yourSeat.seat;

  // Live action clock for whichever seat is to act. Your own deadline arrives
  // reliably on ACTION_REQUIRED (state.actionDeadline); other seats fall back to
  // the broadcast table deadline.
  const activeDeadline =
    yourSeat != null && table?.toActSeat === yourSeat.seat
      ? state.actionDeadline
      : (table?.actionDeadline ?? null);
  const clock = useActionClock(table?.toActSeat ?? null, activeDeadline);

  // AFK cues: a beep + a tab-title ping the moment it becomes your turn, with a
  // persisted mute toggle. The visual cue is the pulsing action bar below.
  const [muted, setMuted] = useState(false);
  useEffect(() => {
    try {
      setMuted(localStorage.getItem("velvet_mute_turn") === "1");
    } catch {
      /* localStorage unavailable */
    }
  }, []);
  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      try {
        localStorage.setItem("velvet_mute_turn", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  useTurnAlert(isYourTurn, muted);

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

  // The whole table fits one screen: a fixed-height flex column (viewport minus
  // the app header + page padding ≈ 8rem) where the felt absorbs the slack and
  // everything else is compact, so the page itself never scrolls.
  return (
    <div className="flex h-[calc(100dvh-8rem)] flex-col gap-2.5">
      {/* Compact header */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="truncate font-display text-xl text-ivory">
            {props.tableName}
          </h1>
          <p className="text-[11px] text-ash">
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
        <div className="flex items-center gap-1.5">
          {props.demo && (
            <span
              className="rounded-full border border-velvet/25 bg-velvet/[0.06] px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-velvet/90"
              title="Free play — demo chips, no wallet or deposit needed. Nothing here is real money."
            >
              Free play
            </span>
          )}
          {isSpectator && (
            <span className="rounded-full border border-velvet/30 bg-velvet/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-velvet/90">
              Spectating
            </span>
          )}
          <span
            className={`h-2 w-2 rounded-full ${
              state.connected ? "bg-emerald-400" : "bg-amber-400 animate-pulse-soft"
            }`}
          />
          <button
            type="button"
            onClick={toggleMute}
            aria-label={muted ? "Unmute turn alerts" : "Mute turn alerts"}
            title={muted ? "Turn sound off" : "Turn sound on"}
            className="grid h-7 w-7 place-items-center rounded-full border border-white/10 bg-white/5 text-sm text-ash transition-colors hover:text-ivory"
          >
            {muted ? "🔇" : "🔔"}
          </button>
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

      {/* Felt — grows to fill the remaining height so nothing spills off-screen */}
      <div className="relative flex min-h-0 flex-1 flex-col gap-2 overflow-hidden rounded-3xl border border-felt-light/30 bg-felt-radial p-3 shadow-elevated sm:p-5">
        {/* Seats */}
        <div className="flex shrink-0 flex-wrap items-stretch justify-center gap-2">
          {table?.seats.map((s) => (
            <Seat
              key={s.seat}
              seat={s}
              asset={props.asset}
              isDealer={table.dealerSeat === s.seat}
              isToAct={table.toActSeat === s.seat}
              isYou={s.playerId === youToken}
              holeCards={s.playerId === youToken ? state.holeCards : null}
              clock={table.toActSeat === s.seat ? clock : null}
            />
          ))}
        </div>

        {/* Board + pot, centered in the remaining space */}
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
          {table && table.community.length > 0 ? (
            <div className="flex origin-center scale-[0.55] items-center justify-center gap-1.5 min-[420px]:scale-[0.7] sm:scale-90 sm:gap-3 lg:scale-100">
              {table.community.map((c) => (
                <Card3D key={c} card={c} size="lg" />
              ))}
            </div>
          ) : (
            <p className="text-sm text-ivory/50">
              {table?.handId ? "Awaiting the flop" : "Waiting for the next hand"}
            </p>
          )}
          {table && (
            <div className="rounded-full border border-velvet/30 bg-charcoal-900/40 px-4 py-1.5">
              <span className="text-xs text-ash">Pot </span>
              <span className="font-mono text-velvet">
                {formatAmount(props.asset, BigInt(table.totalPot))} {unit}
              </span>
            </div>
          )}
        </div>

        {/* Your hand — compact, anchored at the foot of the felt */}
        {seated && state.holeCards && state.holeCards.length > 0 && (
          <div className="flex shrink-0 items-end justify-center gap-3">
            {state.holeCards.map((c) => (
              <Card3D key={c} card={c} size="md" tilt />
            ))}
          </div>
        )}

        {/* Showdown — overlaid so it never changes the layout height */}
        {state.lastShowdown && (
          <div className="absolute inset-x-3 bottom-3 mx-auto max-w-md rounded-xl border border-velvet/30 bg-charcoal-900/95 p-3 backdrop-blur">
            <p className="mb-1 text-[11px] uppercase tracking-wider text-ash">
              Showdown
            </p>
            <ul className="space-y-0.5 text-sm">
              {state.lastShowdown.results
                .filter((r) => BigInt(r.amountWon) > 0n)
                .map((r) => (
                  <li key={r.seat} className="text-ivory">
                    Seat {r.seat + 1} wins{" "}
                    {formatAmount(props.asset, BigInt(r.amountWon))} {unit} —{" "}
                    {r.handDescription}
                  </li>
                ))}
            </ul>
          </div>
        )}
      </div>

      {/* Action / buy-in — pinned just below the felt */}
      <div className="shrink-0">
        {isSpectator ? (
          <div className="card-surface flex flex-col items-center gap-2 p-4 text-center">
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
            bigBlind={BigInt(table.bigBlind)}
            pot={BigInt(table.totalPot)}
            isPreflop={table.community.length === 0}
            yourStack={BigInt(yourSeat!.stack)}
            yourCommitted={BigInt(yourSeat!.committedThisStreet)}
            secondsLeft={clock?.secondsLeft ?? null}
            onAction={act}
          />
        ) : (
          <p className="rounded-2xl border border-white/10 bg-charcoal-800/60 py-3 text-center text-sm text-ash">
            {table?.toActSeat != null
              ? `Waiting on seat ${table.toActSeat + 1}…`
              : "Waiting for the next hand…"}
          </p>
        )}
        {state.error && (
          <p className="mt-1 text-center text-sm text-red-300">{state.error}</p>
        )}
      </div>

      {/* Chat — a single compact row; history floats above when opened */}
      <div className="relative shrink-0">
        {chatOpen && (
          <div className="absolute bottom-full mb-2 max-h-40 w-full space-y-1 overflow-y-auto rounded-xl border border-white/10 bg-charcoal-900/95 p-3 text-sm shadow-elevated backdrop-blur">
            {state.chat.length === 0 ? (
              <p className="text-xs text-ash/60">No messages yet.</p>
            ) : (
              state.chat.map((m, i) => (
                <p key={i} className="text-ash">
                  <span className="text-ivory">{m.from}:</span> {m.message}
                </p>
              ))
            )}
          </div>
        )}
        {isSpectator ? (
          <p className="text-center text-xs text-ash/60">
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
            className="flex items-center gap-2"
          >
            <button
              type="button"
              onClick={() => setChatOpen((o) => !o)}
              aria-label="Toggle table chat"
              title="Table chat"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/5 text-sm text-ash transition-colors hover:text-ivory"
            >
              💬
            </button>
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

/**
 * Ticks while it's someone's turn and returns the seconds left + a 0..1 fraction
 * for the depleting bar. The full duration is captured when the turn starts, so
 * the bar is accurate without the client knowing the configured timeout.
 */
function useActionClock(
  toActSeat: number | null,
  deadline: number | null,
): { secondsLeft: number; fraction: number } | null {
  const [now, setNow] = useState(() => Date.now());
  const totalRef = useRef<{ key: string; total: number } | null>(null);

  useEffect(() => {
    if (toActSeat == null || deadline == null) {
      totalRef.current = null;
      return;
    }
    const key = `${toActSeat}:${deadline}`;
    if (!totalRef.current || totalRef.current.key !== key) {
      totalRef.current = { key, total: Math.max(1000, deadline - Date.now()) };
    }
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [toActSeat, deadline]);

  if (toActSeat == null || deadline == null) return null;
  const msLeft = Math.max(0, deadline - now);
  const total = totalRef.current?.total ?? 30_000;
  return {
    secondsLeft: Math.ceil(msLeft / 1000),
    fraction: Math.max(0, Math.min(1, msLeft / total)),
  };
}

let sharedAudioCtx: AudioContext | null = null;

/** A short two-note chime via Web Audio (no asset needed). Best-effort. */
function playTurnChime() {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    sharedAudioCtx = sharedAudioCtx ?? new Ctx();
    const ctx = sharedAudioCtx;
    if (ctx.state === "suspended") void ctx.resume();
    const t0 = ctx.currentTime;
    (
      [
        [660, 0],
        [880, 0.16],
      ] as const
    ).forEach(([freq, off]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const start = t0 + off;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
      osc.start(start);
      osc.stop(start + 0.16);
    });
  } catch {
    /* audio blocked or unavailable — non-fatal */
  }
}

/**
 * Fires the AFK cues when it becomes your turn: a chime (unless muted) and a
 * tab-title ping that's restored when your turn ends or the view unmounts.
 */
function useTurnAlert(isYourTurn: boolean, muted: boolean) {
  const prev = useRef(false);
  const originalTitle = useRef<string | null>(null);

  useEffect(() => {
    if (originalTitle.current == null && typeof document !== "undefined") {
      originalTitle.current = document.title;
    }
    if (isYourTurn && !prev.current) {
      if (!muted) playTurnChime();
      if (typeof document !== "undefined") {
        document.title = "🔔 Your turn — Velvet Poker";
      }
    } else if (!isYourTurn && prev.current) {
      if (typeof document !== "undefined" && originalTitle.current != null) {
        document.title = originalTitle.current;
      }
    }
    prev.current = isYourTurn;
  }, [isYourTurn, muted]);

  useEffect(() => {
    return () => {
      if (typeof document !== "undefined" && originalTitle.current != null) {
        document.title = originalTitle.current;
      }
    };
  }, []);
}
