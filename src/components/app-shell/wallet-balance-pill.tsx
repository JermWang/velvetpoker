"use client";

import { useEffect, useState } from "react";
import { ASSET_SYMBOLS, ASSET_DECIMALS } from "@/lib/ledger/money";
import type { Asset } from "@/lib/ledger/money";
import { authedFetch } from "@/lib/auth/privy-token";

/** Compact 2-decimal balance for the nav. Full precision lives on the cashier. */
function shortBalance(asset: Asset, base: string): string {
  return (Number(BigInt(base)) / 10 ** ASSET_DECIMALS[asset]).toFixed(2);
}

interface WireBalance {
  asset: Asset;
  amount: string;
}

/**
 * Shows the player's CONNECTED WALLET on-chain SOL + USDC (not their in-app
 * deposited balance). Self-fetching so it never blocks server rendering of the
 * nav; refreshes on an interval.
 */
export function WalletBalancePill() {
  const [balances, setBalances] = useState<WireBalance[] | null>(null);
  const [hasWallet, setHasWallet] = useState(true);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await authedFetch("/api/wallet/balances");
        if (!res.ok) return;
        const json = (await res.json()) as {
          address: string | null;
          balances?: WireBalance[];
        };
        if (!alive) return;
        setHasWallet(json.address != null);
        setBalances(json.balances ?? []);
      } catch {
        /* leave the last good values in place */
      }
    }
    load();
    const id = setInterval(load, 45_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (!hasWallet) return null;

  const shown: WireBalance[] =
    balances ?? [
      { asset: "SOL", amount: "0" },
      { asset: "USDC", amount: "0" },
    ];

  return (
    <div className="flex items-center gap-2">
      {shown.map((b) => (
        <div
          key={b.asset}
          className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5"
          title={`Your connected wallet ${ASSET_SYMBOLS[b.asset]} balance`}
        >
          <span className="text-xs font-medium text-velvet">
            {ASSET_SYMBOLS[b.asset]}
          </span>
          <span className="font-mono text-sm text-ivory">
            {balances ? shortBalance(b.asset, b.amount) : "…"}
          </span>
        </div>
      ))}
    </div>
  );
}
