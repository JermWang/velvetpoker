"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { formatAmount, parseAmount, ASSET_SYMBOLS } from "@/lib/ledger/money";
import type { Asset } from "@/lib/ledger/money";

// Tidy a shorthand decimal (".3" -> "0.3", "3." -> "3"). The parser accepts both.
function normalizeDecimal(v: string): string {
  let s = v.trim();
  if (!s) return v;
  if (s.startsWith(".")) s = `0${s}`;
  if (s.endsWith(".")) s = s.slice(0, -1);
  return s;
}

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
  onBuyIn: (amount: string, password?: string) => void | Promise<void>;
  demo?: boolean;
  requiresPassword?: boolean;
}) {
  const [amount, setAmount] = useState(formatAmount(asset, minBuyIn));
  const [password, setPassword] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
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

  // Explicit sign-off so a real-money buy-in is never accidental: the player
  // sees the exact amount leaving their balance and confirms before sitting.
  if (confirming && parsed !== null && !amountError) {
    return (
      <div className="card-surface mx-auto max-w-sm p-6 text-center">
        <h3 className="font-display text-lg text-ivory">Confirm buy-in</h3>
        <p className="mt-3 text-sm text-ash">You&apos;re about to sit down with</p>
        <p className="mt-1 font-mono text-3xl text-ivory">
          {amount} <span className="text-velvet">{sym}</span>
        </p>
        <p className="mt-3 text-sm leading-relaxed text-ash">
          This is real money. {amount} {sym} moves to the table. If your playable
          balance is short, you&apos;ll approve a wallet transfer to top it up
          first — you can cash out your remaining stack any time you&apos;re not in
          a hand.
        </p>
        {busy && (
          <p className="mt-4 text-xs leading-relaxed text-ash">
            Approve the transfer in your wallet, then hold tight while it confirms
            on-chain.
          </p>
        )}
        {submitError && (
          <p className="mt-4 text-xs leading-relaxed text-red-300">{submitError}</p>
        )}
        <div className="mt-5 flex gap-2">
          <Button
            variant="ghost"
            className="flex-1"
            disabled={busy}
            onClick={() => {
              setSubmitError(null);
              setConfirming(false);
            }}
          >
            Cancel
          </Button>
          <Button
            className="flex-1"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setSubmitError(null);
              try {
                await onBuyIn(amount, requiresPassword ? password : undefined);
                setConfirming(false);
              } catch (e) {
                setSubmitError(
                  e instanceof Error ? e.message : "Could not complete the buy-in.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Confirming…" : "Confirm & sit"}
          </Button>
        </div>
      </div>
    );
  }

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
          onBlur={() => setAmount(normalizeDecimal(amount))}
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
        onClick={() => setConfirming(true)}
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
