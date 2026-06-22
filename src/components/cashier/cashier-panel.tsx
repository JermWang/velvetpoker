"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpHint } from "@/components/ui/tooltip";

export function CashierPanel({
  canPlay,
  tokenConfigured,
  tokenSymbol,
}: {
  canPlay: boolean;
  tokenConfigured: boolean;
  tokenSymbol: string;
}) {
  const router = useRouter();
  const [address, setAddress] = useState<string | null>(null);
  const [loadingAddr, setLoadingAddr] = useState(false);
  const [wAsset, setWAsset] = useState("SOL");
  const [wSubmitting, setWSubmitting] = useState(false);
  const [wMessage, setWMessage] = useState<string | null>(null);
  const [wError, setWError] = useState<string | null>(null);

  async function getAddress() {
    setLoadingAddr(true);
    const res = await fetch("/api/cashier/deposit-address", { method: "POST" });
    const json = await res.json();
    setLoadingAddr(false);
    if (res.ok) setAddress(json.address);
  }

  async function withdraw(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setWSubmitting(true);
    setWError(null);
    setWMessage(null);
    const form = new FormData(e.currentTarget);
    const res = await fetch("/api/cashier/withdraw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        asset: wAsset,
        amount: String(form.get("amount") ?? ""),
        toAddress: String(form.get("toAddress") ?? ""),
      }),
    });
    const json = await res.json();
    setWSubmitting(false);
    if (!res.ok) {
      setWError(json.error ?? "Withdrawal failed");
      return;
    }
    setWMessage(
      json.requiresReview
        ? "Withdrawal submitted for review. Larger amounts are reviewed before sending."
        : "Withdrawal approved and queued for sending.",
    );
    router.refresh();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Deposit */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            Deposit
            <HelpHint label="Send funds from the Solana wallet you signed in with. We match the deposit to your account automatically and credit it after on-chain confirmations." />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-ash">
            Send SOL, USDC{tokenConfigured ? `, or ${tokenSymbol}` : ""} (SPL)
            to the deposit address below{" "}
            <span className="text-ivory">from your connected wallet</span>. Your
            deposit is matched to your account by the sending wallet, then
            credited after on-chain confirmations.
          </p>
          {address ? (
            <div className="rounded-xl border border-white/10 bg-charcoal-900/60 p-4">
              <p className="text-xs text-ash">Velvet deposit address</p>
              <p className="mt-1 break-all font-mono text-sm text-ivory">
                {address}
              </p>
            </div>
          ) : (
            <Button onClick={getAddress} disabled={loadingAddr} variant="secondary">
              {loadingAddr ? "Loading…" : "Show deposit address"}
            </Button>
          )}
          <p className="text-xs text-ash/70">
            Deposit only from the Solana wallet you signed in with — funds sent
            from another wallet can&apos;t be matched to your account
            automatically. Only send Solana-network assets; other networks may
            result in permanent loss.
          </p>
        </CardContent>
      </Card>

      {/* Withdraw */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            Withdraw
            <HelpHint label="Cash out to any Solana address. Small amounts are sent automatically; larger ones get a quick manual review before sending, for safety." />
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!canPlay && (
            <p className="mb-4 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-amber-200">
              Some account checks are incomplete. You can still withdraw existing
              funds; new deposits and play may be limited.
            </p>
          )}
          <form onSubmit={withdraw} className="space-y-4">
            <div>
              <Label htmlFor="wAsset">Asset</Label>
              <Select
                id="wAsset"
                value={wAsset}
                onChange={(e) => setWAsset(e.target.value)}
              >
                <option value="SOL">SOL</option>
                <option value="USDC">USDC</option>
                {tokenConfigured && (
                  <option value="TOKEN">{tokenSymbol}</option>
                )}
              </Select>
            </div>
            <div>
              <Label htmlFor="amount">Amount</Label>
              <Input id="amount" name="amount" placeholder="0.5" required />
            </div>
            <div>
              <Label htmlFor="toAddress">Destination address</Label>
              <Input
                id="toAddress"
                name="toAddress"
                placeholder="Solana address"
                required
              />
            </div>
            {wError && <p className="text-sm text-red-300">{wError}</p>}
            {wMessage && <p className="text-sm text-emerald-300">{wMessage}</p>}
            <Button type="submit" disabled={wSubmitting}>
              {wSubmitting ? "Submitting…" : "Request withdrawal"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
