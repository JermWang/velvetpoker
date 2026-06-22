import { cn, initials } from "@/lib/utils";
import { formatAmount } from "@/lib/ledger/money";
import type { Asset } from "@/lib/ledger/money";
import type { WireSeat } from "@/lib/realtime/events";
import { PlayingCard } from "./playing-card";
import { Card3D } from "./card-3d";
import type { Card } from "@/lib/poker/types";

/** Short verb (+ amount where it reads clearly) for a seat's last move. */
function actionLabel(
  la: NonNullable<WireSeat["lastAction"]>,
  asset: Asset,
): string {
  switch (la.action) {
    case "CHECK":
      return "Check";
    case "CALL":
      return `Call ${formatAmount(asset, BigInt(la.amount))}`;
    case "BET":
      return `Bet ${formatAmount(asset, BigInt(la.amount))}`;
    case "RAISE":
      return `Raise ${formatAmount(asset, BigInt(la.amount))}`;
    case "ALL_IN":
      return "All-in";
    case "FOLD":
      return "Fold";
    default:
      return "";
  }
}

/**
 * A player position on the rim of the oval table — a tactile pod with a circular
 * avatar, a depleting timer ring for the seat to act, the dealer button, a
 * name/stack pill, and the player's cards tucked above. Live bets are rendered
 * separately as chips on the felt by the table view.
 */
export function Seat({
  seat,
  asset,
  isDealer,
  isToAct,
  isYou,
  holeCards,
  clock,
  revealCards,
  handLabel,
  show3d,
  isWinner,
}: {
  seat: WireSeat;
  asset: Asset;
  isDealer: boolean;
  isToAct: boolean;
  isYou: boolean;
  holeCards?: Card[] | null;
  /** Live action clock for the seat to act; null for every other seat. */
  clock?: { secondsLeft: number; fraction: number } | null;
  /** Opponent hole cards to flip face-up at showdown (null otherwise). */
  revealCards?: Card[] | null;
  /** Hand-rank label shown under the pod at showdown (e.g. "Two Pair"). */
  handLabel?: string | null;
  /** At a contested showdown, flip YOUR hand to the premium 3D card. */
  show3d?: boolean;
  /** This seat won the pot — pulse the avatar gold. */
  isWinner?: boolean;
}) {
  if (!seat.playerId) {
    return (
      <div className="grid h-11 w-11 place-items-center rounded-full border border-dashed border-white/12 text-[10px] text-ash/40">
        {seat.seat + 1}
      </div>
    );
  }

  const urgent = clock != null && clock.secondsLeft <= 5;
  const showdownCards = revealCards && revealCards.length ? revealCards : null;
  const revealed = showdownCards ?? (isYou ? holeCards : (seat.holeCards ?? null));
  // Show the card row whenever the player is in the hand OR we're revealing at
  // showdown (their seat may already be flagged out-of-hand by settlement).
  const showCards = seat.inHand || showdownCards != null;
  const C = 2 * Math.PI * 25; // timer-ring circumference (r = 25)

  return (
    <div
      className={cn(
        "relative flex flex-col items-center transition-opacity duration-300",
        seat.hasFolded && "opacity-40",
      )}
    >
      {/* Cards — tucked above the avatar, toward the board */}
      {showCards && (
        <div
          className={cn(
            "relative z-10 mb-[-8px] flex",
            isYou ? "gap-1.5" : "gap-px",
          )}
          style={{ filter: "drop-shadow(0 8px 14px rgba(0,0,0,0.45))" }}
        >
          {revealed ? (
            revealed.map((c) =>
              isYou && show3d ? (
                <Card3D key={c} card={c} size="md" glow float />
              ) : (
                <PlayingCard key={c} card={c} size={isYou ? "md" : "sm"} />
              ),
            )
          ) : (
            <>
              <PlayingCard size="sm" faceDown />
              <PlayingCard size="sm" faceDown />
            </>
          )}
        </div>
      )}

      {/* Avatar with timer ring + dealer button */}
      <div className="relative">
        {isToAct && clock && (
          <svg
            viewBox="0 0 56 56"
            className="absolute left-1/2 top-1/2 h-[60px] w-[60px] -translate-x-1/2 -translate-y-1/2 -rotate-90"
            style={{ overflow: "visible" }}
          >
            <circle
              cx="28"
              cy="28"
              r="25"
              fill="none"
              stroke="rgba(0,0,0,0.4)"
              strokeWidth="3"
            />
            <circle
              cx="28"
              cy="28"
              r="25"
              fill="none"
              strokeWidth="3"
              strokeLinecap="round"
              stroke={urgent ? "#f87171" : "#d66a76"}
              strokeDasharray={C}
              strokeDashoffset={C * (1 - clock.fraction)}
              style={{ transition: "stroke-dashoffset 0.25s linear" }}
            />
          </svg>
        )}
        <div
          className={cn(
            "grid h-12 w-12 place-items-center rounded-full border-2 text-[13px] font-semibold tracking-wide transition-shadow",
            isWinner && "animate-win-glow",
            isYou
              ? "border-velvet bg-velvet/20 text-ivory"
              : "border-white/15 bg-charcoal-700 text-ivory",
          )}
          style={
            isToAct
              ? {
                  boxShadow: urgent
                    ? "0 0 0 2px #f87171, 0 0 22px rgba(248,113,113,0.5)"
                    : "0 0 0 2px #b03a48, 0 0 22px rgba(143,29,44,0.55)",
                }
              : undefined
          }
        >
          {isYou ? "YOU" : initials(seat.displayName)}
        </div>
        {isDealer && (
          <span className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full bg-ivory text-[10px] font-bold text-charcoal-900 ring-2 ring-charcoal-900">
            D
          </span>
        )}
      </div>

      {/* Name + stack pill */}
      <div
        className={cn(
          "-mt-1.5 min-w-[3.75rem] max-w-[7rem] rounded-full px-2.5 py-0.5 text-center shadow-sm",
          isToAct ? "bg-velvet/40" : "bg-charcoal-900/85",
        )}
        style={{ border: "1px solid rgba(255,255,255,0.08)" }}
      >
        <p className="truncate text-[11px] leading-tight text-ivory-muted">
          {isYou ? "You" : (seat.displayName ?? "Player")}
        </p>
        <p
          className="font-mono text-[11px] leading-tight"
          style={{ color: seat.isAllIn ? "#e7b9c0" : "#e7b9c0" }}
        >
          {seat.isAllIn ? "ALL-IN" : formatAmount(asset, BigInt(seat.stack))}
        </p>
      </div>

      {handLabel ? (
        <span className="mt-1 max-w-[7rem] truncate rounded-md border border-amber-300/40 bg-amber-300/15 px-2 py-px text-[9px] font-semibold uppercase tracking-[0.1em] text-amber-100 shadow-sm">
          {handLabel}
        </span>
      ) : seat.hasFolded ? (
        <span className="mt-1 rounded-md border border-white/8 bg-charcoal-900/85 px-1.5 py-px text-[9px] uppercase tracking-[0.13em] text-ash/80">
          Fold
        </span>
      ) : seat.lastAction ? (
        <span className="mt-1 rounded-md border border-velvet/45 bg-velvet/25 px-2 py-px text-[9px] font-semibold uppercase tracking-[0.1em] text-ivory shadow-sm">
          {actionLabel(seat.lastAction, asset)}
        </span>
      ) : (
        !seat.inHand && (
          <span className="mt-0.5 text-[9px] uppercase tracking-wide text-ash/50">
            {seat.sittingOut ? "Sitting out" : "Waiting"}
          </span>
        )
      )}
    </div>
  );
}
