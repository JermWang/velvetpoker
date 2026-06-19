import { cn, initials } from "@/lib/utils";
import { formatAmount } from "@/lib/ledger/money";
import type { Asset } from "@/lib/ledger/money";
import type { WireSeat } from "@/lib/realtime/events";
import { PlayingCard } from "./playing-card";
import type { Card } from "@/lib/poker/types";

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
  const empty = !seat.playerId;
  const urgent = clock != null && clock.secondsLeft <= 5;

  return (
    <div
      className={cn(
        "flex w-40 flex-col items-center gap-2 rounded-2xl border p-3 transition-all",
        empty
          ? "border-dashed border-white/10 bg-transparent"
          : "border-white/10 bg-charcoal-800/80",
        isToAct && "border-velvet/70 animate-turn",
        seat.hasFolded && "opacity-40",
      )}
    >
      {empty ? (
        <span className="py-6 text-xs text-ash/60">Seat {seat.seat + 1}</span>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "grid h-9 w-9 place-items-center rounded-full border text-xs",
                isYou
                  ? "border-velvet/50 bg-velvet/15 text-velvet"
                  : "border-white/15 bg-white/5 text-ivory",
              )}
            >
              {initials(seat.displayName)}
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-ivory">
                {seat.displayName ?? "Player"}
              </p>
              <p className="font-mono text-xs text-ash">
                {formatAmount(asset, BigInt(seat.stack))}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {seat.inHand ? (
              isYou && holeCards ? (
                holeCards.map((c) => <PlayingCard key={c} card={c} size="sm" />)
              ) : seat.holeCards ? (
                seat.holeCards.map((c) => <PlayingCard key={c} card={c} size="sm" />)
              ) : (
                <>
                  <PlayingCard size="sm" faceDown />
                  <PlayingCard size="sm" faceDown />
                </>
              )
            ) : (
              <span className="text-[10px] text-ash/60">
                {seat.sittingOut ? "Sitting out" : "Waiting"}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isDealer && (
              <span className="grid h-5 w-5 place-items-center rounded-full bg-ivory text-[10px] font-bold text-charcoal-900">
                D
              </span>
            )}
            {seat.isAllIn && (
              <span className="text-[10px] font-semibold text-velvet">ALL-IN</span>
            )}
            {BigInt(seat.committedThisStreet) > 0n && (
              <span className="font-mono text-[11px] text-velvet">
                {formatAmount(asset, BigInt(seat.committedThisStreet))}
              </span>
            )}
          </div>

          {/* Live action clock — visible to everyone so an AFK player reads at
              a glance, and turns red in the final seconds. */}
          {isToAct && clock && (
            <div className="mt-0.5 w-full">
              <div className="mb-1 flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-wider">
                <span
                  className={cn(
                    "inline-block h-1.5 w-1.5 rounded-full",
                    urgent ? "bg-red-400 animate-pulse-soft" : "bg-velvet",
                  )}
                />
                <span className={urgent ? "text-red-300" : "text-velvet"}>
                  To act · {clock.secondsLeft}s
                </span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] duration-200 ease-linear",
                    urgent ? "bg-red-400" : "bg-velvet",
                  )}
                  style={{ width: `${Math.round(clock.fraction * 100)}%` }}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
