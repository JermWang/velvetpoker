"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { formatAmount } from "@/lib/ledger/money";
import type { Asset } from "@/lib/ledger/money";

export function BuyInPanel({
  asset,
  minBuyIn,
  maxBuyIn,
  onBuyIn,
}: {
  asset: Asset;
  minBuyIn: bigint;
  maxBuyIn: bigint;
  onBuyIn: (amount: string) => void;
}) {
  const [amount, setAmount] = useState(formatAmount(asset, minBuyIn));
  return (
    <div className="card-surface mx-auto max-w-sm p-6 text-center">
      <h3 className="font-display text-lg text-ivory">Take a seat</h3>
      <p className="mt-1 text-sm text-ash">
        Buy in between {formatAmount(asset, minBuyIn)} and{" "}
        {formatAmount(asset, maxBuyIn)} {asset}.
      </p>
      <div className="mt-4 text-left">
        <Label htmlFor="buyin">Buy-in amount</Label>
        <Input
          id="buyin"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>
      <Button className="mt-4 w-full" onClick={() => onBuyIn(amount)}>
        Buy in &amp; sit
      </Button>
      <p className="mt-3 text-xs text-ash/70">
        Funds move from your available balance to the table, locked in the
        ledger while you play.
      </p>
    </div>
  );
}
