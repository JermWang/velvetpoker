"use client";

import { useEffect, useState } from "react";
import { ASSET_SYMBOLS, ASSET_DECIMALS } from "@/lib/ledger/money";
import type { Asset } from "@/lib/ledger/money";
import { authedFetch } from "@/lib/auth/privy-token";

interface Playable {
  asset: Asset;
  available: string;
  locked: string;
}
interface WalletBal {
  asset: Asset;
  amount: string;
}

/** Compact 2-decimal amount from base units. */
function fmt(asset: Asset, base: string): string {
  return (Number(BigInt(base)) / 10 ** ASSET_DECIMALS[asset]).toFixed(2);
}

/**
 * Nav balances. The PRIMARY pill is the player's in-app PLAYABLE balance
 * (deposited funds) — buy-ins, wins, and losses move this, so a wagered buy-in
 * visibly draws it down. The secondary "Wallet" chip is the on-chain balance in
 * their connected wallet (only deposits/withdrawals change it). Self-fetching +
 * polled so play activity shows without a page refresh.
 */
export function WalletBalancePill() {
  const [playable, setPlayable] = useState<Playable[] | null>(null);
  const [wallet, setWallet] = useState<WalletBal[]>([]);
  const [hasWallet, setHasWallet] = useState(true);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await authedFetch("/api/wallet/balances");
        if (!res.ok) return;
        const json = (await res.json()) as {
          address: string | null;
          playable?: Playable[];
          wallet?: WalletBal[];
        };
        if (!alive) return;
        setHasWallet(json.address != null);
        setPlayable(json.playable ?? []);
        setWallet(json.wallet ?? []);
      } catch {
        /* keep the last good values */
      }
    }
    load();
    const id = setInterval(load, 10_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const playableShown = (playable ?? []).filter(
    (b) => BigInt(b.available) > 0n || BigInt(b.locked) > 0n,
  );
  const walletShown = wallet.filter((b) => BigInt(b.amount) > 0n);

  return (
    <div className="flex items-center gap-2">
      {/* Playable (in-app) — the chips you actually play with. */}
      {playable === null ? (
        <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 font-mono text-sm text-ash">
          …
        </div>
      ) : playableShown.length === 0 ? (
        <div
          className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 font-mono text-sm text-ash"
          title="Your playable balance. Deposit on the Cashier to play."
        >
          0.00
        </div>
      ) : (
        playableShown.map((b) => (
          <div
            key={b.asset}
            className="flex items-center gap-1.5 rounded-full border border-velvet/30 bg-velvet/[0.08] px-3 py-1.5"
            title={`Playable ${ASSET_SYMBOLS[b.asset]} (deposited). Buy-ins draw from this.`}
          >
            <span className="text-xs font-medium text-velvet">
              {ASSET_SYMBOLS[b.asset]}
            </span>
            <span className="font-mono text-sm text-ivory">
              {fmt(b.asset, b.available)}
            </span>
            {BigInt(b.locked) > 0n && (
              <span className="font-mono text-[11px] text-ash">
                +{fmt(b.asset, b.locked)} in play
              </span>
            )}
          </div>
        ))
      )}

      {/* Wallet (on-chain) — what's in the connected wallet; deposits move this. */}
      {hasWallet && walletShown.length > 0 && (
        <div
          className="hidden items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 sm:flex"
          title="Your connected wallet (on-chain). Deposit on the Cashier to play with it."
        >
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ash/70">
            Wallet
          </span>
          {walletShown.map((b) => (
            <span key={b.asset} className="font-mono text-xs text-ash">
              {fmt(b.asset, b.amount)} {ASSET_SYMBOLS[b.asset]}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
