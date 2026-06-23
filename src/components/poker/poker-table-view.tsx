"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTableSocket } from "@/lib/realtime/use-table-socket";
import type { ServerEvent } from "@/lib/realtime/events";
import { formatAmount, parseAmount, ASSET_SYMBOLS } from "@/lib/ledger/money";
import type { Asset } from "@/lib/ledger/money";
import type { ActionType, Card } from "@/lib/poker/types";
import {
  playSound,
  soundForAction,
  preloadSounds,
  isMuted as soundIsMuted,
  setMuted as setSoundMuted,
} from "@/lib/sound/sound";
import { Seat } from "./seat";
import { useTableMedia } from "@/lib/media/use-table-media";
import { RotatePrompt } from "./rotate-prompt";
import { PlayingCard } from "./playing-card";
import { ActionBar } from "./action-bar";
import { BuyInPanel } from "./buy-in-panel";
import { VerifyHandDrawer } from "./verify-hand-drawer";
import { Button } from "@/components/ui/button";
import { ConnectButton } from "@/components/auth/connect-button";
import { cn } from "@/lib/utils";

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
  /** Private table with a password — prompt for it on buy-in. */
  requiresPassword?: boolean;
  /** LiveKit configured — enables the table voice/video controls. */
  voiceEnabled?: boolean;
}

/** The branded velvet poker chip (black + gold "V"), from /public. */
function Chip({ size = 20 }: { size?: number }) {
  return (
    <img
      src="/velvet-poker-chip.png"
      alt=""
      aria-hidden
      width={size}
      height={size}
      draggable={false}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        objectFit: "contain",
        filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.45))",
      }}
    />
  );
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

  // Sound effects: play on the moves everyone sees (action applied), on the
  // deal, and a win flourish at showdown if you took a pot. Gated by the same
  // mute toggle as the turn alert (synced into the sound module below).
  const playerTokenRef = useRef<string | null>(null);
  const onEvent = useCallback((e: ServerEvent) => {
    switch (e.t) {
      case "PLAYER_ACTION_APPLIED": {
        const s = soundForAction(e.action);
        if (s) playSound(s);
        break;
      }
      case "HAND_STARTED":
        playSound("deal");
        break;
      case "SHOWDOWN": {
        const me = playerTokenRef.current;
        if (me && e.results.some((r) => r.playerId === me && BigInt(r.amountWon) > 0n)) {
          playSound("win");
        }
        break;
      }
    }
  }, []);

  const { state, send } = useTableSocket({
    wsUrl: props.wsUrl,
    tableId: props.tableId,
    authQuery,
    onEvent,
  });
  const [chatInput, setChatInput] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  // Pre-action ("act ahead of turn") — applied automatically when it's our turn.
  const [preAction, setPreAction] = useState<
    null | "fold" | "checkfold" | "check" | "callany"
  >(null);
  // Portrait/mobile layout: the felt fills the screen as a tall oval and seats
  // ring it, instead of being squished into the wide desktop table container.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Spectator status is fixed by the connection mode; seat identity comes from
  // the opaque per-table token the server sends (real ids are never broadcast).
  const isSpectator = !props.guestMode && props.youUserId == null;
  const youToken = state.playerToken;
  playerTokenRef.current = youToken;
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
  // One mute for all table audio, persisted by the sound module (single key).
  const [muted, setMuted] = useState(false);
  useEffect(() => {
    preloadSounds();
    setMuted(soundIsMuted());
  }, []);
  useEffect(() => {
    setSoundMuted(muted);
  }, [muted]);
  const toggleMute = useCallback(() => setMuted((m) => !m), []);
  useTurnAlert(isYourTurn, muted);

  // Table voice/video (LiveKit). Opt-in — connects only when the player taps
  // "Join voice". Gated to signed-in players at a voice-enabled table.
  const voiceAvailable = !!props.voiceEnabled && props.youUserId != null;
  const media = useTableMedia({
    tableId: props.tableId,
    seatToken: youToken,
    enabled: voiceAvailable,
  });

  function act(action: ActionType, amount?: bigint) {
    send({
      t: "PLAYER_ACTION",
      tableId: props.tableId,
      action,
      amount: amount?.toString(),
    });
  }

  function buyIn(amount: string, password?: string, seatNumber?: number) {
    try {
      const lamports = parseAmount(props.asset, amount);
      send({
        t: "BUY_IN",
        tableId: props.tableId,
        amount: lamports.toString(),
        ...(password ? { password } : {}),
        ...(seatNumber != null ? { seatNumber } : {}),
      });
    } catch {
      /* ignore parse errors; the field guides format */
    }
  }

  // Free play: tap an open seat to sit straight down with a free stack — no
  // module, no amount to pick.
  function sitFree(seatNumber: number) {
    buyIn(formatAmount(props.asset, BigInt(props.maxBuyIn)), undefined, seatNumber);
  }

  function toggleSitOut() {
    if (!yourSeat) return;
    send({ t: "SIT_OUT", tableId: props.tableId, sitOut: !yourSeat.sittingOut });
  }

  function rebuyToMax() {
    if (!yourSeat) return;
    const add = BigInt(props.maxBuyIn) - BigInt(yourSeat.stack);
    if (add > 0n) {
      send({ t: "REBUY", tableId: props.tableId, amount: add.toString() });
    }
  }

  // Apply an armed pre-action the moment it becomes our turn (then disarm).
  useEffect(() => {
    if (!isYourTurn || preAction === null) return;
    const toCall = state.toCall;
    let chosen: ActionType | null = null;
    if (preAction === "fold") chosen = "FOLD";
    else if (preAction === "checkfold") chosen = toCall === 0n ? "CHECK" : "FOLD";
    else if (preAction === "check") chosen = toCall === 0n ? "CHECK" : null;
    else if (preAction === "callany") chosen = toCall === 0n ? "CHECK" : "CALL";
    setPreAction(null);
    if (chosen) act(chosen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isYourTurn, preAction, state.toCall]);

  // Disarm pre-actions at the start of each hand so nothing carries over stale.
  useEffect(() => {
    setPreAction(null);
  }, [table?.handId]);

  // Demo tables use free chips; real tables are labeled by their asset symbol.
  const unit = props.demo ? "chips" : ASSET_SYMBOLS[props.asset];

  // Oval-table layout: every seat is placed on an ellipse at a FIXED position
  // (seat 0 bottom-center, increasing clockwise). No hero rotation — you stay
  // seated exactly where you clicked, and the seating is consistent for everyone.
  const seatCount = table?.seats.length ?? 0;
  const heroSlotAnchor = 0;

  // Showdown reveals: map each shown seat -> its hole cards + hand rank. Server
  // only sends cards for a contested showdown, so uncontested wins reveal none.
  const showdownBySeat = useMemo(() => {
    const m = new Map<number, { cards: Card[]; handDescription: string }>();
    for (const r of state.lastShowdown?.results ?? []) {
      if (r.cards && r.cards.length > 0) {
        m.set(r.seat, { cards: r.cards, handDescription: r.handDescription });
      }
    }
    return m;
  }, [state.lastShowdown]);

  // The whole table fits one screen: a fixed-height flex column (viewport minus
  // the app header + page padding ≈ 8rem) where the felt absorbs the slack and
  // everything else is compact, so the page itself never scrolls.
  return (
    <div className="flex h-[calc(100dvh-8rem)] flex-col gap-2.5">
      {/* Phones: nudge to landscape (the table plays far better wide). */}
      <RotatePrompt />
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
              className="hidden rounded-full border border-velvet/25 bg-velvet/[0.06] px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-velvet/90 sm:inline-block"
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
            aria-label={muted ? "Unmute table sounds" : "Mute table sounds"}
            title={muted ? "Sound off" : "Sound on"}
            className="grid h-7 w-7 place-items-center rounded-full border border-white/10 bg-white/5 text-sm text-ash transition-colors hover:text-ivory"
          >
            {muted ? "🔇" : "🔊"}
          </button>

          {/* Table voice/video (opt-in) */}
          {voiceAvailable && media.status !== "on" && (
            <Button
              size="sm"
              variant="ghost"
              className="whitespace-nowrap px-2 text-xs"
              onClick={() => media.join()}
              disabled={media.status === "connecting"}
              title="Join table voice & video"
            >
              {media.status === "connecting" ? "Joining…" : "🎙 Join voice"}
            </Button>
          )}
          {voiceAvailable && media.status === "on" && (
            <>
              <button
                type="button"
                onClick={() => media.toggleMic()}
                aria-label={media.micOn ? "Mute microphone" : "Unmute microphone"}
                title={media.micOn ? "Mic on" : "Mic off"}
                className={cn(
                  "grid h-7 w-7 place-items-center rounded-full border text-sm transition-colors",
                  media.micOn
                    ? "border-velvet/50 bg-velvet/20 text-ivory"
                    : "border-white/10 bg-white/5 text-ash hover:text-ivory",
                )}
              >
                {media.micOn ? "🎙" : "🔇"}
              </button>
              <button
                type="button"
                onClick={() => media.toggleCam()}
                aria-label={media.camOn ? "Turn camera off" : "Turn camera on"}
                title={media.camOn ? "Camera on" : "Camera off"}
                className={cn(
                  "grid h-7 w-7 place-items-center rounded-full border text-sm transition-colors",
                  media.camOn
                    ? "border-velvet/50 bg-velvet/20 text-ivory"
                    : "border-white/10 bg-white/5 text-ash hover:text-ivory",
                )}
              >
                {media.camOn ? "📹" : "📷"}
              </button>
              <button
                type="button"
                onClick={() => media.leave()}
                aria-label="Leave table voice"
                title="Leave voice"
                className="grid h-7 w-7 place-items-center rounded-full border border-red-400/30 bg-red-400/10 text-sm text-red-200 transition-colors hover:bg-red-400/20"
              >
                ✕
              </button>
            </>
          )}
          {/* Provable-fairness drawer — only for real (persisted) hands; demo
              hands aren't recorded, so there'd be nothing to verify. */}
          {!props.demo && <VerifyHandDrawer handId={table?.handId ?? null} />}
          {seated && (
            <Button
              size="sm"
              variant="ghost"
              className="whitespace-nowrap px-2 text-xs"
              onClick={toggleSitOut}
              title={yourSeat?.sittingOut ? "Return to play" : "Sit out the next hand"}
            >
              {yourSeat?.sittingOut ? "I'm back" : "Sit out"}
            </Button>
          )}
          {seated && BigInt(yourSeat?.stack ?? "0") < BigInt(props.maxBuyIn) && (
            <Button
              size="sm"
              variant="ghost"
              className="whitespace-nowrap px-2 text-xs"
              onClick={rebuyToMax}
              title="Top up to the max stack"
            >
              + Chips
            </Button>
          )}
          {seated && (
            <Button
              size="sm"
              variant="ghost"
              className="whitespace-nowrap px-2 text-xs"
              onClick={() => send({ t: "LEAVE_TABLE", tableId: props.tableId })}
            >
              Leave
            </Button>
          )}
        </div>
      </div>

      {/* Felt — a bounded oval table in its own container; top padding gives the
          top-row seats headroom so their cards aren't clipped at the edge. */}
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-3xl pb-2 pt-3 shadow-elevated sm:pb-10 sm:pt-12"
        style={{
          background:
            "radial-gradient(120% 90% at 50% 8%, rgba(27,77,58,0.18), transparent 55%), #0c0d10",
        }}
      >
        {/* Keep the Claude-design aspect (1180×560) so the oval stays proportional;
            grow it as large as the viewport height allows. */}
        <div className="relative h-full w-full sm:aspect-[820/620] sm:mx-auto sm:h-auto sm:max-h-full sm:max-w-3xl">
          {/* Rail + felt surface — insets match the prototype (18px / 96px on
              1180×560 ≈ 3.2% vertical, 8.1% horizontal). */}
          <div className="pointer-events-none absolute" style={{ inset: "3.2% 8.1%" }}>
            <div
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: "50%",
                background:
                  "linear-gradient(180deg,#2c171b 0%,#1a0d10 60%,#140a0c 100%)",
                padding: 20,
                boxSizing: "border-box",
                boxShadow:
                  "0 44px 90px -38px rgba(0,0,0,0.85), inset 0 2px 0 rgba(255,255,255,0.06), inset 0 0 0 1px rgba(176,58,72,0.26), inset 0 -8px 20px rgba(0,0,0,0.5)",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 20,
                  borderRadius: "50%",
                  overflow: "hidden",
                  background:
                    "radial-gradient(ellipse at 50% 40%, #1d5440 0%, #143b2d 50%, #0c2820 100%)",
                  boxShadow:
                    "inset 0 0 70px rgba(0,0,0,0.55), inset 0 0 0 2px rgba(255,255,255,0.04), inset 0 0 0 7px rgba(12,40,32,0.55)",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background:
                      "repeating-linear-gradient(45deg, rgba(255,255,255,0.011) 0 2px, transparent 2px 6px)",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    inset: 16,
                    borderRadius: "50%",
                    border: "1px solid rgba(176,58,72,0.16)",
                  }}
                />
                <div
                  className="font-display"
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: "50%",
                    transform: "translate(-50%,-58%)",
                    fontSize: 210,
                    color: "rgba(255,255,255,0.022)",
                    lineHeight: 1,
                  }}
                >
                  V
                </div>
              </div>
            </div>
          </div>

          {/* Center — board + pot */}
          <div className="absolute inset-x-[10%] inset-y-[24%] flex flex-col items-center justify-center gap-2 sm:inset-x-[16%] sm:inset-y-[30%] sm:gap-3">
            {table && table.community.length > 0 ? (
              <div className="flex origin-center scale-[0.5] items-center justify-center gap-1.5 min-[420px]:scale-[0.62] sm:scale-100 sm:gap-2">
                {table.community.map((c) => (
                  <PlayingCard key={c} card={c} size="lg" />
                ))}
              </div>
            ) : (
              <p className="text-center text-xs text-ivory/45">
                {table?.handId ? "Awaiting the flop" : "Waiting for the next hand"}
              </p>
            )}
            {table && (
              // key on the pot value so the pill re-mounts and "pops" when it grows.
              <div
                key={table.totalPot}
                className="animate-pot-pop flex items-center gap-2 rounded-full border border-velvet/30 bg-charcoal-900/55 px-3.5 py-1.5 backdrop-blur"
              >
                <Chip size={22} />
                <span className="text-[11px] text-ash">Pot</span>
                <span className="font-mono text-sm text-velvet-soft">
                  {formatAmount(props.asset, BigInt(table.totalPot))} {unit}
                </span>
              </div>
            )}
          </div>

          {/* Live bets — chips on the felt in front of each player */}
          {table?.seats.map((s) => {
            if (!s.playerId) return null;
            const bet = BigInt(s.committedThisStreet);
            if (bet <= 0n) return null;
            const pos = seatPosition(
              (s.seat - heroSlotAnchor + seatCount) % seatCount,
              seatCount,
              isMobile,
            );
            const bx = pos.x + (50 - pos.x) * 0.34;
            const by = pos.y + (48 - pos.y) * 0.34;
            return (
              <div
                key={`bet-${s.seat}`}
                className="absolute z-[4] -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${bx}%`, top: `${by}%` }}
              >
                <div className="animate-chip-in flex items-center gap-1.5">
                  <Chip size={18} />
                  <span className="rounded-full border border-white/8 bg-charcoal-900/80 px-2 py-px font-mono text-[10px] text-ivory">
                    {formatAmount(props.asset, bet)}
                  </span>
                </div>
              </div>
            );
          })}

          {/* Seats around the rim */}
          {table?.seats.map((s) => {
            const pos = seatPosition(
              (s.seat - heroSlotAnchor + seatCount) % seatCount,
              seatCount,
              isMobile,
            );
            const winResult = state.lastShowdown?.results.find(
              (r) => r.seat === s.seat && BigInt(r.amountWon) > 0n,
            );
            const winAmt = winResult ? BigInt(winResult.amountWon) : null;
            return (
              <div
                key={s.seat}
                className="absolute z-[5]"
                style={{
                  left: `${pos.x}%`,
                  top: `${pos.y}%`,
                  transform: "translate(-50%, -50%)",
                }}
              >
                {/* Win flourish — amount rises and fades over the winner. */}
                {winAmt != null && (
                  <div
                    key={`win-${table.handId}-${s.seat}`}
                    className="animate-win-rise pointer-events-none absolute left-1/2 -top-3 z-20 -translate-x-1/2 whitespace-nowrap rounded-full bg-amber-300/90 px-2 py-0.5 text-[11px] font-bold text-charcoal-900 shadow-elevated"
                  >
                    +{formatAmount(props.asset, winAmt)} {unit}
                  </div>
                )}
                {/* Free play: empty seats are tap-to-sit (no buy-in module). */}
                {!s.playerId && props.demo && !seated && !isSpectator ? (
                  <button
                    type="button"
                    onClick={() => sitFree(s.seat)}
                    aria-label={`Sit at seat ${s.seat + 1}`}
                    className="grid h-11 w-11 place-items-center rounded-full border border-dashed border-velvet/60 bg-velvet/10 text-[9px] font-semibold uppercase tracking-wide text-velvet transition-colors hover:border-velvet hover:bg-velvet/25 hover:text-ivory"
                  >
                    Sit
                  </button>
                ) : (
                  <Seat
                    seat={s}
                    asset={props.asset}
                    isDealer={table.dealerSeat === s.seat}
                    isToAct={table.toActSeat === s.seat}
                    isYou={s.playerId != null && s.playerId === youToken}
                    holeCards={
                      s.playerId != null && s.playerId === youToken
                        ? state.holeCards
                        : null
                    }
                    clock={table.toActSeat === s.seat ? clock : null}
                    revealCards={showdownBySeat.get(s.seat)?.cards ?? null}
                    handLabel={showdownBySeat.get(s.seat)?.handDescription ?? null}
                    show3d={showdownBySeat.size > 0}
                    isWinner={winAmt != null}
                    compact={isMobile}
                    videoTrack={
                      s.playerId ? (media.videoBySeat.get(s.playerId) ?? null) : null
                    }
                  />
                )}
              </div>
            );
          })}

          {/* Showdown — overlaid at the top: winners first, then losing hands,
              by name (not seat number), so the result reads at a glance. */}
          {state.lastShowdown &&
            (() => {
              const nameFor = (seat: number) =>
                table?.seats.find((s) => s.seat === seat)?.displayName ??
                `Seat ${seat + 1}`;
              const results = [...state.lastShowdown.results].sort((a, b) => {
                const d = BigInt(b.amountWon) - BigInt(a.amountWon);
                return d > 0n ? 1 : d < 0n ? -1 : 0;
              });
              return (
                <div className="absolute inset-x-4 top-1 z-[8] mx-auto max-w-md rounded-xl border border-velvet/30 bg-charcoal-900/95 p-2.5 backdrop-blur">
                  <p className="mb-1 text-[11px] uppercase tracking-wider text-ash">
                    Showdown
                  </p>
                  <ul className="space-y-0.5 text-sm">
                    {results.map((r) => {
                      const won = BigInt(r.amountWon);
                      return (
                        <li
                          key={r.seat}
                          className={won > 0n ? "text-ivory" : "text-ash/70"}
                        >
                          <span className={won > 0n ? "font-medium text-velvet-soft" : ""}>
                            {nameFor(r.seat)}
                          </span>{" "}
                          {won > 0n
                            ? `wins ${formatAmount(props.asset, won)} ${unit} · ${r.handDescription}`
                            : r.handDescription}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })()}
        </div>
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
          props.demo ? (
            <p className="rounded-2xl border border-velvet/25 bg-velvet/[0.06] py-3 text-center text-sm text-velvet/90">
              Tap an open seat to sit down with a free stack.
            </p>
          ) : (
            <BuyInPanel
              asset={props.asset}
              minBuyIn={BigInt(props.minBuyIn)}
              maxBuyIn={BigInt(props.maxBuyIn)}
              onBuyIn={buyIn}
              demo={props.demo}
              requiresPassword={props.requiresPassword}
            />
          )
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
        ) : seated && BigInt(yourSeat!.stack) === 0n ? (
          <div className="rounded-2xl border border-velvet/30 bg-velvet/[0.06] p-3 text-center">
            <p className="text-sm text-ivory">You&apos;re out of chips.</p>
            <Button size="sm" className="mt-2" onClick={rebuyToMax}>
              {props.demo ? "Get more free chips" : "Rebuy"}
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Pre-action: queue your move before it's your turn. */}
            {yourSeat?.inHand && !yourSeat.sittingOut && (
              <div className="flex flex-wrap justify-center gap-1.5">
                {(
                  [
                    ["checkfold", "Check/Fold"],
                    ["check", "Check"],
                    ["callany", "Call any"],
                    ["fold", "Fold"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setPreAction((p) => (p === key ? null : key))}
                    className={cn(
                      "rounded-lg border px-2.5 py-1 text-xs transition-colors",
                      preAction === key
                        ? "border-velvet bg-velvet/25 text-ivory"
                        : "border-white/12 text-ash hover:text-ivory",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <p className="rounded-2xl border border-white/10 bg-charcoal-800/60 py-3 text-center text-sm text-ash">
              {table?.toActSeat != null
                ? `Waiting on ${
                    table.seats.find((s) => s.seat === table.toActSeat)?.displayName ??
                    `seat ${table.toActSeat + 1}`
                  }…`
                : "Waiting for the next hand…"}
            </p>
          </div>
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
 * Place a seat on the table ellipse. Slot 0 sits at the bottom-center (the
 * hero); the remaining slots fan out clockwise around the rim.
 */
function seatPosition(
  slot: number,
  n: number,
  mobile = false,
): { x: number; y: number } {
  const angle = Math.PI / 2 + (n > 0 ? (slot / n) * Math.PI * 2 : 0);
  // Desktop is a wide oval (rx > ry). Portrait/mobile is a TALL oval: narrow the
  // horizontal radius and grow the vertical one so seats ring the upright felt
  // instead of being crammed onto a squished wide table.
  if (mobile) {
    // A tall, elongated oval (not a circle): narrow the horizontal radius so
    // side seats don't crowd, and stretch the vertical radius so seats spread
    // down the length of the felt. Reads far less cluttered on a phone.
    return { x: 50 + 31 * Math.cos(angle), y: 47 + 41 * Math.sin(angle) };
  }
  // rx leaves room for the ~100px-wide seat clusters at the sides; ry is kept
  // modest and the ring sits a touch low so the TOP-row seats keep their cards
  // clear of the felt edge (with the felt's top padding adding more headroom).
  return { x: 50 + 37 * Math.cos(angle), y: 50 + 31 * Math.sin(angle) };
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
