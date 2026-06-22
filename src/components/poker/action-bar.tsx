"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatAmount, parseAmount } from "@/lib/ledger/money";
import type { Asset } from "@/lib/ledger/money";
import type { ActionType } from "@/lib/poker/types";

interface Preset {
  label: string;
  value: bigint;
}

export function ActionBar({
  asset,
  toCall,
  minRaiseTo,
  currentBet,
  bigBlind,
  pot,
  isPreflop,
  yourStack,
  yourCommitted,
  secondsLeft,
  onAction,
}: {
  asset: Asset;
  toCall: bigint;
  minRaiseTo: bigint;
  currentBet: bigint;
  bigBlind: bigint;
  pot: bigint;
  isPreflop: boolean;
  yourStack: bigint;
  yourCommitted: bigint;
  /** Seconds remaining on your action clock, for the urgency readout. */
  secondsLeft: number | null;
  onAction: (action: ActionType, amount?: bigint) => void;
}) {
  const maxTotal = yourCommitted + yourStack;
  const [raiseTo, setRaiseTo] = useState(formatAmount(asset, minRaiseTo));
  const canCheck = toCall === 0n;
  const facingBet = currentBet > yourCommitted;
  // There's room for a real (non all-in) bet/raise only if the min legal
  // raise-to is reachable with the stack.
  const canRaise = maxTotal >= minRaiseTo;

  // Reset the field to the minimum whenever a new decision starts (the min
  // changes between streets / after a raise), so presets start from a clean base.
  useEffect(() => {
    setRaiseTo(formatAmount(asset, minRaiseTo));
  }, [asset, minRaiseTo]);

  // Customizable quick-bet sizes (% of pot, postflop). Persisted per device.
  const DEFAULT_PCTS = [33, 50, 75, 100];
  const [pcts, setPcts] = useState<number[]>(DEFAULT_PCTS);
  const [showSettings, setShowSettings] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("vp:betpcts");
      if (raw) {
        const p = JSON.parse(raw);
        if (Array.isArray(p) && p.length === 4) setPcts(p.map((n) => Number(n) || 0));
      }
    } catch {
      /* ignore */
    }
  }, []);
  function updatePct(i: number, val: number) {
    setPcts((prev) => {
      const next = prev.map((v, j) => (j === i ? val : v));
      try {
        localStorage.setItem("vp:betpcts", JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const clampTarget = (t: bigint): bigint => {
    let x = t;
    if (x < minRaiseTo) x = minRaiseTo;
    if (x > maxTotal) x = maxTotal;
    return x;
  };

  // Preflop: multiples of the bet being faced (the big blind when unopened) —
  // the familiar "open to 3×" sizing. Postflop: fractions of the pot, sized so
  // the raise-to accounts for first calling, like a commercial client.
  const rawPresets: Preset[] = isPreflop
    ? [2n, 3n, 4n].map((m) => ({
        label: `${m}×`,
        value: clampTarget(m * (currentBet > 0n ? currentBet : bigBlind)),
      }))
    : pcts.map((pct) => ({
        label: `${pct}%`,
        // Pot-fraction raise-to: call first, then add pct% of the resulting pot.
        value: clampTarget(
          yourCommitted + toCall + (BigInt(Math.round(pct)) * (pot + toCall)) / 100n,
        ),
      }));

  // Drop presets that collapse onto the same amount (e.g. a short stack where
  // 3× and 4× both clamp to all-in).
  const presets = rawPresets.filter(
    (p, i) => rawPresets.findIndex((q) => q.value === p.value) === i,
  );

  // Numeric mirror of the raise-to field for the slider. parseAmount throws on a
  // half-typed value, so fall back to the minimum.
  let raiseNum = Number(minRaiseTo);
  try {
    raiseNum = Number(parseAmount(asset, raiseTo));
  } catch {
    /* mid-edit; keep the fallback */
  }
  const sliderMin = Number(minRaiseTo);
  const sliderMax = Number(maxTotal);
  const sliderStep = Math.max(1, Number(bigBlind));
  const sliderVal = Math.min(Math.max(raiseNum, sliderMin), sliderMax);

  function submitRaise() {
    let target: bigint;
    try {
      target = parseAmount(asset, raiseTo);
    } catch {
      return;
    }
    if (target > maxTotal) target = maxTotal;
    onAction(currentBet === 0n ? "BET" : "RAISE", target);
  }

  const urgent = secondsLeft != null && secondsLeft <= 5;

  return (
    <div className="animate-attn space-y-3 rounded-2xl border border-velvet/40 bg-charcoal-800/90 p-3.5 shadow-elevated">
      <div className="flex items-center justify-between px-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-velvet-soft">
          Your turn
        </span>
        {secondsLeft != null && (
          <span
            className={`font-mono text-xs ${urgent ? "text-red-300" : "text-ash"}`}
          >
            {secondsLeft}s
          </span>
        )}
      </div>

      {/* Bet sizing — presets + slider, only when a real raise is possible */}
      {canRaise && (
        <div className="relative space-y-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-ash/70">
              {isPreflop ? "Open" : "Pot"}
            </span>
            {presets.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setRaiseTo(formatAmount(asset, p.value))}
                className="rounded-lg border border-velvet/30 bg-velvet/[0.08] px-2.5 py-1 text-xs font-medium text-velvet-soft transition-colors hover:bg-velvet/20"
              >
                {p.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setRaiseTo(formatAmount(asset, maxTotal))}
              className="rounded-lg border border-velvet/30 bg-velvet/[0.08] px-2.5 py-1 text-xs font-medium text-velvet-soft transition-colors hover:bg-velvet/20"
            >
              Max
            </button>
            {/* Customize the quick-bet sizes. */}
            {!isPreflop && (
              <button
                type="button"
                onClick={() => setShowSettings((s) => !s)}
                aria-label="Customize quick bets"
                title="Customize quick bets"
                className="grid h-7 w-7 place-items-center rounded-lg border border-white/12 text-xs text-ash transition-colors hover:text-ivory"
              >
                ⚙
              </button>
            )}
            {/* Editable exact amount — type any custom bet. */}
            <input
              value={raiseTo}
              onChange={(e) => setRaiseTo(e.target.value)}
              inputMode="decimal"
              aria-label="Bet amount"
              className="ml-auto w-24 rounded-lg border border-white/12 bg-charcoal-900/60 px-2 py-1 text-right font-mono text-sm text-ivory focus:border-velvet/50 focus:outline-none"
            />
          </div>

          {/* Quick-bet settings popup. */}
          {showSettings && !isPreflop && (
            <div className="absolute bottom-full left-0 z-20 mb-2 w-full max-w-xs rounded-xl border border-white/12 bg-charcoal-900/97 p-3 shadow-elevated backdrop-blur">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-ash">
                  Quick bets · % of pot
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setPcts(DEFAULT_PCTS);
                    try {
                      localStorage.setItem("vp:betpcts", JSON.stringify(DEFAULT_PCTS));
                    } catch {
                      /* ignore */
                    }
                  }}
                  className="text-[11px] text-velvet-soft hover:text-ivory"
                >
                  Reset
                </button>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {pcts.map((pct, i) => (
                  <label key={i} className="flex flex-col gap-1">
                    <span className="text-center text-[9px] uppercase tracking-wider text-ash/60">
                      Bet {i + 1}
                    </span>
                    <div className="flex items-center rounded-lg border border-white/12 bg-charcoal-800/60 px-1.5">
                      <input
                        type="number"
                        min={1}
                        max={1000}
                        value={pct}
                        onChange={(e) => updatePct(i, Number(e.target.value))}
                        className="w-full bg-transparent py-1 text-center font-mono text-sm text-ivory focus:outline-none"
                      />
                      <span className="text-[10px] text-ash/60">%</span>
                    </div>
                  </label>
                ))}
              </div>
              <p className="mt-2 text-[10px] leading-snug text-ash/60">
                Sets your four one-tap raise sizes. Type any exact amount in the
                field on the right.
              </p>
            </div>
          )}

          <input
            type="range"
            className="vp-range w-full"
            min={sliderMin}
            max={sliderMax}
            step={sliderStep}
            value={sliderVal}
            onChange={(e) =>
              setRaiseTo(formatAmount(asset, BigInt(Math.round(Number(e.target.value)))))
            }
            aria-label="Bet amount slider"
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onAction("FOLD")}
          className="rounded-xl border border-white/14 px-5 py-3 text-sm font-medium text-ivory/80 transition-colors hover:bg-white/5"
        >
          Fold
        </button>
        {canCheck ? (
          <button
            type="button"
            onClick={() => onAction("CHECK")}
            className="rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-ivory transition-colors hover:bg-white/10"
          >
            Check
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onAction("CALL")}
            className="rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-ivory transition-colors hover:bg-white/10"
          >
            Call {formatAmount(asset, toCall)}
          </button>
        )}

        {canRaise && (
          <button
            type="button"
            onClick={submitRaise}
            className="flex-1 rounded-xl bg-velvet px-5 py-3 text-sm font-semibold text-ivory shadow-velvet transition-colors hover:bg-velvet-soft"
            style={{
              boxShadow:
                "0 8px 20px -8px rgba(143,29,44,0.6), inset 0 1px 0 rgba(255,255,255,0.16)",
            }}
          >
            {facingBet ? "Raise to" : "Bet"} {raiseTo}
          </button>
        )}

        <button
          type="button"
          onClick={() => onAction("ALL_IN")}
          className="rounded-xl border border-velvet/50 bg-velvet/[0.14] px-4 py-3 text-sm font-semibold text-velvet-soft transition-colors hover:bg-velvet/25"
        >
          All-in {formatAmount(asset, maxTotal)}
        </button>
      </div>
    </div>
  );
}
