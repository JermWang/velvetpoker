import Link from "next/link";
import { formatAmount, ASSET_SYMBOLS } from "@/lib/ledger/money";
import type { Asset } from "@/lib/ledger/money";
import { Button } from "@/components/ui/button";
import { usdPriceForAsset, type AssetPrices } from "@/lib/pricing/prices";
import { LiveSeats } from "./live-seats";

// USD is the headline: clean whole dollars (with commas) at $1+, two decimals
// only for sub-dollar micro stakes so blinds stay distinct.
function fmtUsd(n: number): string {
  return n >= 1 ? `$${Math.round(n).toLocaleString("en-US")}` : `$${n.toFixed(2)}`;
}
// The USD value as actually shown (rounded), so the SOL line is its exact translation.
function shownUsd(n: number): number {
  return n >= 1 ? Math.round(n) : Math.round(n * 100) / 100;
}
// SOL translation of the headline USD — tidy, ~2 significant figures, no noise.
function fmtSol(n: number): string {
  if (n <= 0) return "0";
  if (n >= 1) {
    const r = Math.round(n * 10) / 10;
    return Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1);
  }
  if (n >= 0.01) return n.toFixed(2);
  return n.toFixed(4);
}

/** Convert a base-unit amount to a USD value for display (null when unpriced). */
function convert(
  amount: bigint,
  asset: Asset,
  prices: AssetPrices,
): { usd: number | null; native: string } {
  const native = formatAmount(asset, amount);
  const up = usdPriceForAsset(asset, prices);
  const usd = up != null ? Number(native) * up : null;
  return { usd, native };
}

/** Build the USD-headline / SOL-translation pair for a single value or a range. */
function priced(
  parts: Array<{ usd: number | null; native: string }>,
  asset: Asset,
  sep: string,
  solUsd: number | null,
): { primary: string; subtext: string | null } {
  const sym = ASSET_SYMBOLS[asset];
  // Everything priced → whole-dollar USD headline.
  if (parts.every((p) => p.usd != null)) {
    const primary = parts.map((p) => fmtUsd(p.usd as number)).join(sep);
    // Token tables are BET in the token, so the translation shows the token
    // amount you'll actually wager. SOL/USDC tables show the SOL equivalent.
    const subtext =
      asset === "TOKEN"
        ? `≈ ${parts.map((p) => p.native).join(sep)} ${sym}`
        : solUsd
          ? `≈ ${parts.map((p) => fmtSol(shownUsd(p.usd as number) / solUsd)).join(sep)} SOL`
          : null;
    return { primary, subtext };
  }
  // Token not yet priced → dash, with the token amount as the small reference.
  if (asset === "TOKEN") {
    return {
      primary: "—",
      subtext: `${parts.map((p) => p.native).join(sep)} ${sym}`,
    };
  }
  // Feed down for SOL/USDC → fall back to the native amount.
  return { primary: `${parts.map((p) => p.native).join(sep)} ${sym}`, subtext: null };
}

export interface TableCardData {
  id: string;
  name: string;
  asset: Asset;
  smallBlind: bigint;
  bigBlind: bigint;
  minBuyIn: bigint;
  maxBuyIn: bigint;
  maxSeats: number;
  seatsOccupied: number;
  visibility: "PUBLIC" | "PRIVATE";
  status: string;
  isDemo?: boolean;
  /** Visual-only placeholder tier — shown but not joinable ("Coming soon"). */
  locked?: boolean;
}

export function TableCard({
  table,
  prices,
  tokenSymbol = "VELVET",
}: {
  table: TableCardData;
  prices: AssetPrices;
  /** Display ticker for the house token (public cash games are wagered in it). */
  tokenSymbol?: string;
}) {
  const live = table.status === "ACTIVE";

  // The little currency pill: free play, the token for public cash games (the
  // betting currency — prices below stay in USD), or the real asset for private.
  const currencyTag = table.isDemo
    ? "FREE"
    : table.visibility === "PRIVATE"
      ? ASSET_SYMBOLS[table.asset]
      : `$${tokenSymbol}`;

  const sb = convert(table.smallBlind, table.asset, prices);
  const bb = convert(table.bigBlind, table.asset, prices);
  const lo = convert(table.minBuyIn, table.asset, prices);
  const hi = convert(table.maxBuyIn, table.asset, prices);
  const blinds = priced([sb, bb], table.asset, " / ", prices.solUsd);
  const buyIn = priced([lo, hi], table.asset, "–", prices.solUsd);

  // Locked "coming soon" tier — visual only (balances the lobby grid), not a
  // joinable table. Shows the stakes, with a clean blur + label on hover.
  if (table.locked) {
    return (
      <div className="group relative cursor-default select-none">
        <div className="glass relative flex h-full flex-col overflow-hidden p-5">
          <div className="relative flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate font-display text-xl text-ivory/90">{table.name}</h3>
              <p className="mt-0.5 text-[11px] uppercase tracking-[0.2em] text-ash/70">
                No-Limit Hold&apos;em
              </p>
            </div>
            <span className="rounded-full border border-white/12 bg-white/[0.04] px-2.5 py-0.5 text-xs font-medium text-ash">
              {currencyTag}
            </span>
          </div>
          <div className="relative mt-5 grid grid-cols-2 gap-3 text-sm">
            <Stat label="Blinds" value={blinds.primary} subtext={blinds.subtext} />
            <Stat label="Buy-in" value={buyIn.primary} subtext={buyIn.subtext} />
          </div>
          <div className="relative mt-5 flex items-center justify-between">
            <span className="text-xs text-ash/70">Higher stakes</span>
            <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-ash/70">
              Coming soon
            </span>
          </div>
        </div>
        {/* Hover: clean blur + "Coming soon" lock overlay. */}
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 rounded-2xl bg-charcoal-900/35 opacity-0 backdrop-blur-md transition-opacity duration-300 group-hover:opacity-100">
          <span className="text-2xl">🔒</span>
          <span className="font-display text-lg text-ivory">Coming soon</span>
          <span className="text-xs text-ash">Higher stakes are on the way</span>
        </div>
      </div>
    );
  }

  return (
    <Link href={`/app/tables/${table.id}`} className="block">
      <div className="glass glass-hover relative flex h-full flex-col overflow-hidden p-5">
        {/* felt sheen accent */}
        <div className="pointer-events-none absolute -left-12 -top-12 h-32 w-32 rounded-full bg-felt-light/20 blur-2xl" />

        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate font-display text-xl text-ivory">{table.name}</h3>
            <p className="mt-0.5 text-[11px] uppercase tracking-[0.2em] text-ash/70">
              No-Limit Hold&apos;em
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <span className="rounded-full border border-velvet/30 bg-velvet/10 px-2.5 py-0.5 text-xs font-medium text-velvet">
              {currencyTag}
            </span>
            <span className="flex items-center gap-1 text-[11px] text-ash">
              <span
                className={`h-1.5 w-1.5 rounded-full ${live ? "bg-emerald-400" : "bg-ash/50"}`}
              />
              {live ? "In play" : "Waiting"}
            </span>
          </div>
        </div>

        {/* at-a-glance stats */}
        <div className="relative mt-5 grid grid-cols-2 gap-3 text-sm">
          <Stat
            label="Blinds"
            value={
              table.isDemo
                ? `${formatAmount(table.asset, table.smallBlind)} / ${formatAmount(table.asset, table.bigBlind)}`
                : blinds.primary
            }
            subtext={table.isDemo ? null : blinds.subtext}
          />
          <Stat
            label="Buy-in"
            value={table.isDemo ? "Free" : buyIn.primary}
            subtext={table.isDemo ? null : buyIn.subtext}
          />
        </div>

        {/* seat occupancy — live, polls the ws server so it reflects who's
            actually seated (incl. the in-memory free table) */}
        <LiveSeats
          tableId={table.id}
          maxSeats={table.maxSeats}
          initialOccupied={table.seatsOccupied}
        />

        <div className="relative mt-5 flex items-center justify-between">
          {table.isDemo ? (
            <span className="text-xs text-velvet/80">Free play · no deposit</span>
          ) : table.visibility === "PRIVATE" ? (
            <span className="text-xs text-ash">Private · invite only</span>
          ) : (
            <span className="text-xs text-ash">Open table</span>
          )}
          <Button size="sm">{table.isDemo ? "Play free" : "Take a seat"}</Button>
        </div>
      </div>
    </Link>
  );
}

function Stat({
  label,
  value,
  subtext,
}: {
  label: string;
  value: string;
  subtext?: string | null;
}) {
  return (
    <div className="rounded-lg bg-white/[0.025] px-3 py-2.5">
      <p className="text-[9px] uppercase tracking-[0.22em] text-ash/55">{label}</p>
      <p className="mt-1 text-[15px] font-semibold leading-none text-ivory">
        {value}
      </p>
      {subtext && (
        <p className="mt-1.5 text-[10px] leading-none text-ash/45">{subtext}</p>
      )}
    </div>
  );
}
