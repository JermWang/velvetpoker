"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatAmount, parseAmount } from "@/lib/ledger/money";
import type { Asset } from "@/lib/ledger/money";
import type { ActionType } from "@/lib/poker/types";

export function ActionBar({
  asset,
  toCall,
  minRaiseTo,
  currentBet,
  yourStack,
  yourCommitted,
  onAction,
}: {
  asset: Asset;
  toCall: bigint;
  minRaiseTo: bigint;
  currentBet: bigint;
  yourStack: bigint;
  yourCommitted: bigint;
  onAction: (action: ActionType, amount?: bigint) => void;
}) {
  const maxTotal = yourCommitted + yourStack;
  const [raiseTo, setRaiseTo] = useState(formatAmount(asset, minRaiseTo));
  const canCheck = toCall === 0n;
  const facingBet = currentBet > yourCommitted;

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

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-gold/30 bg-charcoal-800/90 p-3">
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

      <Button variant="secondary" onClick={() => onAction("ALL_IN")}>
        All-in {formatAmount(asset, maxTotal)}
      </Button>
    </div>
  );
}
