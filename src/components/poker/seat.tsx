import { cn, initials } from "@/lib/utils";
import { formatAmount } from "@/lib/ledger/money";
import type { Asset } from "@/lib/ledger/money";
import type { WireSeat } from "@/lib/realtime/events";
import { PlayingCard } from "./playing-card";
import type { Card } from "@/lib/poker/types";

/**
 * A compact player position — a small circular avatar meant to sit on the rim of
 * the oval table, with name + stack on a pill, the live bet as a chip, the
 * dealer button, and (for the seat to act) a depleting timer ring.
 */
export function Seat({
  seat,
  asset,
  isDealer,
  isToAct,
  isYou,
  holeCards,
  clock,
}: {
  seat: WireSeat;
  asset: Asset;
  isDealer: boolean;
  isToAct: boolean;
  isYou: boolean;
  holeCards?: Card[] | null;
  /** Live action clock for the seat to act; null for every other seat. */
  clock?: { secondsLeft: number; fraction: number } | null;
}) {
  if (!seat.playerId) {
    return (
      <div className="grid h-11 w-11 place-items-center rounded-full border border-dashed border-white/12 text-[10px] text-ash/40">
        {seat.seat + 1}
      </div>
    );
  }

  const urgent = clock != null && clock.secondsLeft <= 5;
  const bet = BigInt(seat.committedThisStreet);
  const revealed = isYou ? holeCards : (seat.holeCards ?? null);
  const C = 2 * Math.PI * 26; // timer-ring circumference

  return (
    <div className={cn("relative flex flex-col items-center", seat.hasFolded && "opacity-40")}>
      {/* Cards — tucked above the avatar, toward the board */}
      {seat.inHand && (
        <div className={cn("relative z-10 mb-[-7px] flex", isYou ? "gap-1" : "gap-px")}>
          {revealed ? (
            revealed.map((c) => (
              <PlayingCard key={c} card={c} size={isYou ? "md" : "sm"} />
            ))
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
          <svg viewBox="0 0 56 56" className="absolute -inset-1 h-14 w-14 -rotate-90">
            <circle cx="28" cy="28" r="26" fill="none" stroke="rgba(0,0,0,0.4)" strokeWidth="3" />
            <circle
              cx="28"
              cy="28"
              r="26"
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
            "grid h-12 w-12 place-items-center rounded-full border-2 text-sm font-semibold transition-colors",
            isToAct
              ? urgent
                ? "border-red-400"
                : "border-velvet animate-turn"
              : isYou
                ? "border-velvet/60"
                : "border-white/15",
            isYou ? "bg-velvet/20 text-velvet" : "bg-charcoal-800 text-ivory",
          )}
        >
          {initials(seat.displayName)}
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
          "-mt-1 min-w-[3.5rem] max-w-[6.5rem] rounded-full px-2 py-0.5 text-center shadow-sm",
          isToAct ? "bg-velvet/30" : "bg-charcoal-900/85",
        )}
      >
        <p className="truncate text-[11px] leading-tight text-ivory">
          {seat.displayName ?? "Player"}
        </p>
        <p className="font-mono text-[11px] leading-tight text-velvet/90">
          {seat.isAllIn ? "ALL-IN" : formatAmount(asset, BigInt(seat.stack))}
        </p>
      </div>

      {/* Live bet chip — shown for opponents; your own bet is implied by the
          action bar, and skipping it keeps the hero cluster clear of the edge. */}
      {bet > 0n && !isYou && (
        <span className="mt-1 flex items-center gap-1 rounded-full border border-velvet/40 bg-charcoal-900/90 px-2 py-px font-mono text-[10px] text-velvet">
          <span className="h-2 w-2 rounded-full bg-velvet" />
          {formatAmount(asset, bet)}
        </span>
      )}

      {!seat.inHand && (
        <span className="mt-0.5 text-[9px] uppercase tracking-wide text-ash/50">
          {seat.sittingOut ? "Sitting out" : "Waiting"}
        </span>
      )}
    </div>
  );
}
