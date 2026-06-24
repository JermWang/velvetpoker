"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { formatAmount, ASSET_SYMBOLS, type Asset } from "@/lib/ledger/money";
import { authedFetch } from "@/lib/auth/privy-token";

interface AssetBalance {
  asset: Asset;
  claimable: string;
  totalEarned: string;
}

export function ReferralPanel({
  code,
  refereeCount,
  balances,
}: {
  code: string;
  refereeCount: number;
  balances: AssetBalance[];
}) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const link = useMemo(() => {
    const origin =
      typeof window !== "undefined" ? window.location.origin : "https://www.velvetpoker.fun";
    return `${origin}/?ref=${code}`;
  }, [code]);

  const totalClaimable = balances.reduce((a, b) => a + BigInt(b.claimable), 0n);
  const hasClaimable = totalClaimable > 0n;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — user can select manually */
    }
  }

  async function claim() {
    setClaiming(true);
    setMessage(null);
    const res = await authedFetch("/api/referrals/claim", { method: "POST" });
    const json = await res.json();
    setClaiming(false);
    if (!res.ok) {
      setMessage(json.error ?? "Claim failed");
      return;
    }
    const parts = Object.entries(json.claimed as Record<string, string>)
      .filter(([, v]) => BigInt(v) > 0n)
      .map(([asset, v]) => `${formatAmount(asset as Asset, BigInt(v))} ${ASSET_SYMBOLS[asset as Asset]}`);
    setMessage(
      parts.length
        ? `Claimed ${parts.join(" + ")} into your available balance.`
        : "Nothing to claim right now.",
    );
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-velvet/20 bg-velvet/[0.03] p-4">
        <p className="text-sm leading-relaxed text-ash">
          Share your link. Anyone who connects through it is linked to you for
          good. You earn <span className="text-ivory">1% of every raked pot</span>{" "}
          they play — a third of the 3% house fee — credited here and claimable to
          your balance any time.
        </p>
      </div>

      {/* Share link */}
      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-ash/70">
          Your referral link
        </p>
        <div className="mt-2 flex items-center gap-2">
          <input
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
            className="h-10 flex-1 rounded-xl border border-white/12 bg-charcoal-900/60 px-3 font-mono text-sm text-ivory focus:outline-none"
          />
          <Button variant="secondary" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="mt-2 text-xs text-ash/60">
          Code: <span className="font-mono text-ivory">{code}</span>
        </p>
      </div>

      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Stat label="Players referred" value={String(refereeCount)} />
        <Stat
          label="Lifetime earned"
          value={balances
            .filter((b) => BigInt(b.totalEarned) > 0n)
            .map((b) => `${formatAmount(b.asset, BigInt(b.totalEarned))} ${ASSET_SYMBOLS[b.asset]}`)
            .join("  ·  ") || "—"}
        />
      </div>

      {/* Claimable + claim */}
      <div className="rounded-xl border border-white/10 bg-charcoal-900/60 p-4">
        <p className="text-xs uppercase tracking-[0.18em] text-ash/70">
          Claimable now
        </p>
        <div className="mt-2 space-y-1">
          {balances.map((b) => (
            <div key={b.asset} className="flex items-center justify-between text-sm">
              <span className="text-ash">{ASSET_SYMBOLS[b.asset]}</span>
              <span className="font-mono text-ivory">
                {formatAmount(b.asset, BigInt(b.claimable))} {ASSET_SYMBOLS[b.asset]}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button onClick={claim} disabled={claiming || !hasClaimable}>
            {claiming ? "Claiming…" : "Claim to balance"}
          </Button>
          {message && <p className="text-sm text-emerald-300">{message}</p>}
        </div>
        <p className="mt-3 text-xs text-ash/60">
          Claimed earnings move to your available balance and can be withdrawn
          from the cashier.
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-charcoal-900/40 p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-ash/70">{label}</p>
      <p className="mt-1 font-display text-xl text-ivory">{value}</p>
    </div>
  );
}
