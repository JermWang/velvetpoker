"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
    : (
        [
          [1n, 3n, "⅓"],
          [1n, 2n, "½"],
          [3n, 4n, "¾"],
          [1n, 1n, "Pot"],
        ] as const
      ).map(([num, den, label]) => ({
        label,
        value: clampTarget(yourCommitted + toCall + (num * (pot + toCall)) / den),
      }));

  // Drop presets that collapse onto the same amount (e.g. a short stack where
  // 3× and 4× both clamp to all-in).
  const presets = rawPresets.filter(
    (p, i) => rawPresets.findIndex((q) => q.value === p.value) === i,
  );

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
    <div className="animate-attn space-y-3 rounded-2xl border border-velvet/40 bg-charcoal-800/90 p-3">
      <div className="flex items-center justify-between px-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-velvet">
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

      {/* Quick-bet presets */}
      {canRaise && presets.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-ash/70">
            {isPreflop ? "Open" : "Pot"}
          </span>
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => setRaiseTo(formatAmount(asset, p.value))}
              className="rounded-lg border border-velvet/30 bg-velvet/5 px-2.5 py-1 text-xs font-medium text-velvet transition-colors hover:bg-velvet/15"
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setRaiseTo(formatAmount(asset, maxTotal))}
            className="rounded-lg border border-velvet/30 bg-velvet/5 px-2.5 py-1 text-xs font-medium text-velvet transition-colors hover:bg-velvet/15"
          >
            Max
          </button>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" onClick={() => onAction("FOLD")}>
          Fold
        </Button>
        {canCheck ? (
          <Button variant="secondary" onClick={() => onAction("CHECK")}>
            Check
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => onAction("CALL")}>
            Call {formatAmount(asset, toCall)}
          </Button>
        )}

        {canRaise && (
          <div className="flex items-center gap-2">
            <Input
              value={raiseTo}
              onChange={(e) => setRaiseTo(e.target.value)}
              className="w-28"
              aria-label="Raise amount"
            />
            <Button onClick={submitRaise}>
              {facingBet ? "Raise to" : "Bet"} {raiseTo}
            </Button>
          </div>
        )}

        <Button variant="secondary" onClick={() => onAction("ALL_IN")}>
          All-in {formatAmount(asset, maxTotal)}
        </Button>
      </div>
    </div>
  );
}
