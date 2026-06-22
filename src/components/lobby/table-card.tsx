import Link from "next/link";
import { formatAmount, ASSET_SYMBOLS } from "@/lib/ledger/money";
import type { Asset } from "@/lib/ledger/money";
import { Button } from "@/components/ui/button";
import { usdPriceForAsset, type AssetPrices } from "@/lib/pricing/prices";

function usdStr(n: number): string {
  if (n >= 1000) return `$${Math.round(n).toLocaleString()}`;
  if (n >= 0.01) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}
function solStr(n: number): string {
  return `${n >= 1 ? n.toFixed(2) : n.toFixed(4)} SOL`;
}

/** Convert a base-unit amount to USD + SOL for display (nulls when unpriced). */
function convert(
  amount: bigint,
  asset: Asset,
  prices: AssetPrices,
): { usd: number | null; sol: number | null; native: string } {
  const native = formatAmount(asset, amount);
  const dec = Number(native);
  const up = usdPriceForAsset(asset, prices);
  const usd = up != null ? dec * up : null;
  const sol = usd != null && prices.solUsd ? usd / prices.solUsd : null;
  return { usd, sol, native };
}

/** Build the USD-primary / SOL-subtext pair for a single value or a range. */
function priced(
  parts: Array<{ usd: number | null; sol: number | null; native: string }>,
  asset: Asset,
  sep: string,
): { primary: string; subtext: string | null } {
  const sym = ASSET_SYMBOLS[asset];
  // Everything priced → USD primary, SOL subtext.
  if (parts.every((p) => p.usd != null)) {
    const primary = parts.map((p) => usdStr(p.usd as number)).join(sep);
    const subtext = parts.every((p) => p.sol != null)
      ? `≈ ${parts.map((p) => solStr(p.sol as number)).join(sep)}`
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
}

const SUIT = "♠";

export function TableCard({
  table,
  prices,
}: {
  table: TableCardData;
  prices: AssetPrices;
}) {
  const seats = Array.from({ length: table.maxSeats }, (_, i) => i < table.seatsOccupied);
  const live = table.status === "ACTIVE";

  const sb = convert(table.smallBlind, table.asset, prices);
  const bb = convert(table.bigBlind, table.asset, prices);
  const lo = convert(table.minBuyIn, table.asset, prices);
  const hi = convert(table.maxBuyIn, table.asset, prices);
  const blinds = priced([sb, bb], table.asset, " / ");
  const buyIn = priced([lo, hi], table.asset, "–");

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
              {table.isDemo ? "FREE" : ASSET_SYMBOLS[table.asset]}
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

        {/* seat occupancy */}
        <div className="relative mt-5">
          <div className="flex items-center justify-between text-[11px] text-ash">
            <span className="uppercase tracking-[0.2em]">Seats</span>
            <span className="font-mono text-ivory">
              {table.seatsOccupied}/{table.maxSeats}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            {seats.map((filled, i) => (
              <span
                key={i}
                className={`grid h-5 w-5 place-items-center rounded-full text-[10px] ${
                  filled
                    ? "border border-velvet/40 bg-velvet/15 text-velvet"
                    : "border border-white/10 text-ash/40"
                }`}
              >
                {filled ? SUIT : ""}
              </span>
            ))}
          </div>
        </div>

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
    <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.2em] text-ash/70">{label}</p>
      <p className="mt-0.5 font-mono text-sm text-ivory">{value}</p>
      {subtext && (
        <p className="mt-px font-mono text-[10px] leading-tight text-ash/55">
          {subtext}
        </p>
      )}
    </div>
  );
}
