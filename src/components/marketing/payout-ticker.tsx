"use client";

import { useEffect, useState } from "react";

type Payout = { amount: string; sym: string; at: string; url: string | null };

/** Compact relative time: "just now", "4m ago", "3h ago", "2d ago". */
function rel(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Trim long decimals for a clean ticker number (e.g. 947,828 / 1.25 / 0.1). */
function pretty(amount: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  return n.toLocaleString(undefined, {
    maximumFractionDigits: n >= 1000 ? 0 : n >= 1 ? 2 : 4,
  });
}

/**
 * Wall-Street-style scrolling ticker of REAL payouts (SENT withdrawals), wired to
 * /api/payouts/recent. Self-fetches + polls so it stays live; renders nothing
 * until there's at least one real payout (never fabricates activity).
 */
export function PayoutTicker() {
  const [payouts, setPayouts] = useState<Payout[] | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch("/api/payouts/recent");
        if (!res.ok) return;
        const json = (await res.json()) as { payouts?: Payout[] };
        if (alive) setPayouts(json.payouts ?? []);
      } catch {
        /* keep the last good values */
      }
    }
    load();
    const id = setInterval(load, 25_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (!payouts || payouts.length === 0) return null;

  // Repeat until wide enough, then duplicate the run for a seamless -50% loop.
  const filled: Payout[] = [];
  while (filled.length < 16) filled.push(...payouts);
  const track = [...filled, ...filled];
  const duration = filled.length * 3.2;

  return (
    <div className="-mx-6 -mt-8 w-[calc(100%+3rem)] overflow-hidden border-b border-white/8 bg-charcoal-900/85 backdrop-blur">
      <style>{`@keyframes velvet-ticker{from{transform:translateX(0)}to{transform:translateX(-50%)}}`}</style>
      <div className="flex h-9 items-center">
        <div className="z-10 flex shrink-0 items-center gap-1.5 border-r border-white/10 bg-charcoal-900/85 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-ash">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
          </span>
          Live payouts
        </div>
        <div className="relative flex-1 overflow-hidden">
          <div
            className="flex w-max items-center whitespace-nowrap hover:[animation-play-state:paused]"
            style={{ animation: `velvet-ticker ${duration}s linear infinite` }}
          >
            {track.map((p, i) => {
              const inner = (
                <span className="mx-4 inline-flex items-center gap-1.5 text-xs">
                  <span className="text-emerald-400" aria-hidden>
                    ▲
                  </span>
                  <span className="font-mono text-ivory">{pretty(p.amount)}</span>
                  <span className="font-semibold text-velvet">{p.sym}</span>
                  <span className="text-ash/50">paid · {rel(p.at)}</span>
                </span>
              );
              return p.url ? (
                <a
                  key={i}
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="transition-opacity hover:opacity-80"
                >
                  {inner}
                </a>
              ) : (
                <span key={i}>{inner}</span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
