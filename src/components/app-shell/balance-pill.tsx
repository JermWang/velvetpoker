import { formatAmount, ASSET_SYMBOLS } from "@/lib/ledger/money";
import type { Asset } from "@/lib/ledger/money";

export interface BalanceView {
  asset: Asset;
  available: bigint;
  locked: bigint;
}

export function BalancePill({ balances }: { balances: BalanceView[] }) {
  return (
    <div className="flex items-center gap-2">
      {balances.map((b) => (
        <div
          key={b.asset}
          className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5"
          title={`${formatAmount(b.asset, b.locked)} ${ASSET_SYMBOLS[b.asset]} locked in play`}
        >
          <span className="text-xs font-medium text-velvet">{ASSET_SYMBOLS[b.asset]}</span>
          <span className="font-mono text-sm text-ivory">
            {formatAmount(b.asset, b.available)}
          </span>
          {b.locked > 0n && (
            <span className="font-mono text-[11px] text-ash">
              +{formatAmount(b.asset, b.locked)} in play
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
