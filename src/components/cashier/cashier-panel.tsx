"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpHint } from "@/components/ui/tooltip";
import { authedFetch } from "@/lib/auth/privy-token";

export function CashierPanel({
  canPlay,
  tokenConfigured,
  tokenSymbol,
  connectedWallet,
  available,
}: {
  canPlay: boolean;
  tokenConfigured: boolean;
  tokenSymbol: string;
  /** The player's connected Solana wallet — the one-click withdraw destination. */
  connectedWallet: string | null;
  /** Available (withdrawable) balance per asset, as decimal strings. */
  available: Array<{ asset: string; amount: string }>;
}) {
  const router = useRouter();
  const [address, setAddress] = useState<string | null>(null);
  const [loadingAddr, setLoadingAddr] = useState(false);
  const [copied, setCopied] = useState(false);
  const [addrError, setAddrError] = useState<string | null>(null);
  const [wAsset, setWAsset] = useState("SOL");
  const [wAmount, setWAmount] = useState("");
  // Default the destination to the player's own connected wallet so they never
  // have to paste an address (the #1 source of withdrawal mistakes).
  const [wTo, setWTo] = useState(connectedWallet ?? "");
  const [wSubmitting, setWSubmitting] = useState(false);
  const [wMessage, setWMessage] = useState<string | null>(null);
  const [wError, setWError] = useState<string | null>(null);

  const label = (a: string) => (a === "TOKEN" ? tokenSymbol : a);
  const availableFor = (a: string) =>
    available.find((b) => b.asset === a)?.amount ?? "0";

  async function copyAddress() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable — user can select manually */
    }
  }

  async function getAddress() {
    setLoadingAddr(true);
    setAddrError(null);
    try {
      const res = await authedFetch("/api/cashier/deposit-address", { method: "POST" });
      const json = await res.json();
      if (res.ok) setAddress(json.address);
      else setAddrError(json.error ?? "Couldn't load a deposit address");
    } catch {
      setAddrError("Couldn't load a deposit address");
    } finally {
      setLoadingAddr(false);
    }
  }

  async function withdraw(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setWSubmitting(true);
    setWError(null);
    setWMessage(null);
    const res = await authedFetch("/api/cashier/withdraw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        asset: wAsset,
        amount: wAmount,
        toAddress: wTo.trim(),
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
        ? "Withdrawal submitted — it'll be reviewed, then sent on-chain. Track its status in your history below."
        : "Withdrawal requested — sending on-chain now. Track its status in your history below; a Solscan link appears once it lands (and it's auto-refunded if a send ever fails).",
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
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-ash">Velvet deposit address</p>
                <button
                  type="button"
                  onClick={copyAddress}
                  className="rounded-md border border-white/12 px-2 py-0.5 text-xs text-ash transition-colors hover:text-ivory"
                >
                  {copied ? "Copied ✓" : "Copy"}
                </button>
              </div>
              <p className="mt-1 break-all font-mono text-sm text-ivory">
                {address}
              </p>
            </div>
          ) : (
            <Button onClick={getAddress} disabled={loadingAddr} variant="secondary">
              {loadingAddr ? "Loading…" : "Show deposit address"}
            </Button>
          )}
          {addrError && <p className="text-xs text-red-300">{addrError}</p>}
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
              <div className="flex items-center justify-between">
                <Label htmlFor="amount">Amount</Label>
                <span className="text-xs text-ash/80">
                  Available: {availableFor(wAsset)} {label(wAsset)}
                  <button
                    type="button"
                    onClick={() => setWAmount(availableFor(wAsset))}
                    className="ml-2 rounded border border-white/12 px-1.5 py-px text-[10px] text-velvet hover:text-ivory"
                  >
                    Max
                  </button>
                </span>
              </div>
              <Input
                id="amount"
                name="amount"
                placeholder="0.5"
                inputMode="decimal"
                value={wAmount}
                onChange={(e) => setWAmount(e.target.value)}
                required
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor="toAddress">Destination address</Label>
                {connectedWallet && (
                  <button
                    type="button"
                    onClick={() => setWTo(connectedWallet)}
                    className="rounded border border-white/12 px-1.5 py-px text-[10px] text-velvet hover:text-ivory"
                    title={connectedWallet}
                  >
                    Use connected wallet
                  </button>
                )}
              </div>
              <Input
                id="toAddress"
                name="toAddress"
                placeholder="Solana address"
                value={wTo}
                onChange={(e) => setWTo(e.target.value)}
                required
              />
              {connectedWallet && wTo === connectedWallet && (
                <p className="mt-1 text-[11px] text-ash/70">
                  Sending to your connected wallet.
                </p>
              )}
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
