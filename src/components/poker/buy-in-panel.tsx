"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { formatAmount, parseAmount, ASSET_SYMBOLS } from "@/lib/ledger/money";
import type { Asset } from "@/lib/ledger/money";

export function BuyInPanel({
  asset,
  minBuyIn,
  maxBuyIn,
  onBuyIn,
  demo = false,
  requiresPassword = false,
}: {
  asset: Asset;
  minBuyIn: bigint;
  maxBuyIn: bigint;
  onBuyIn: (amount: string, password?: string) => void;
  demo?: boolean;
  requiresPassword?: boolean;
}) {
  const [amount, setAmount] = useState(formatAmount(asset, minBuyIn));
  const [password, setPassword] = useState("");
  const sym = ASSET_SYMBOLS[asset];

  // Free play: no amount, no SOL/ledger language — just grab a free stack.
  if (demo) {
    return (
      <div className="card-surface mx-auto max-w-sm p-6 text-center">
        <h3 className="font-display text-lg text-ivory">Free play</h3>
        <p className="mt-1 text-sm text-ash">
          Sit down with a free stack. No deposit — nothing here is real money.
        </p>
        <Button
          className="mt-4 w-full"
          onClick={() => onBuyIn(formatAmount(asset, maxBuyIn))}
        >
          Take a free seat
        </Button>
      </div>
    );
  }

  // Inline validation so a typo or out-of-range amount gives instant feedback
  // instead of a dead button or a round-trip error.
  let amountError: string | null = null;
  let parsed: bigint | null = null;
  try {
    parsed = parseAmount(asset, amount);
  } catch {
    amountError = "Enter a valid amount";
  }
  if (parsed !== null) {
    if (parsed < minBuyIn) amountError = `Minimum buy-in is ${formatAmount(asset, minBuyIn)} ${sym}`;
    else if (parsed > maxBuyIn) amountError = `Maximum buy-in is ${formatAmount(asset, maxBuyIn)} ${sym}`;
  }
  const canBuy = !amountError && (!requiresPassword || password.length > 0);

  return (
    <div className="card-surface mx-auto max-w-sm p-6 text-center">
      <h3 className="font-display text-lg text-ivory">Take a seat</h3>
      <p className="mt-1 text-sm text-ash">
        Buy in between {formatAmount(asset, minBuyIn)} and{" "}
        {formatAmount(asset, maxBuyIn)} {sym}.
      </p>
      <div className="mt-4 text-left">
        <Label htmlFor="buyin">Buy-in amount ({sym})</Label>
        <Input
          id="buyin"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
        />
        {requiresPassword && (
          <div className="mt-3">
            <Label htmlFor="tablepw">Table password</Label>
            <Input
              id="tablepw"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Required for this private table"
            />
          </div>
        )}
        {amountError && (
          <p className="mt-2 text-xs text-red-300">{amountError}</p>
        )}
      </div>
      <Button
        className="mt-4 w-full"
        disabled={!canBuy}
        onClick={() => onBuyIn(amount, requiresPassword ? password : undefined)}
      >
        Buy in &amp; sit
      </Button>
      <p className="mt-3 text-xs text-ash/70">
        Funds move from your available balance to the table, locked in the
        ledger while you play.
      </p>
    </div>
  );
}
