/**
 * Live USD prices for the assets we denominate tables in, via Jupiter's public
 * Price API (no key). Used to show table stakes in USD with a SOL reference.
 *
 * Resilient by design: any failure returns nulls and the UI falls back to the
 * native amount, so the lobby never breaks if the feed is down. USDC defaults
 * to $1 when the feed omits it.
 */

import { env } from "@/lib/env";
import type { Asset } from "@/lib/ledger/money";

export const SOL_MINT = "So11111111111111111111111111111111111111112";

export interface AssetPrices {
  /** USD per 1 SOL. */
  solUsd: number | null;
  /** USD per 1 USDC. */
  usdcUsd: number;
  /** USD per 1 token; null until the token has a market price. */
  tokenUsd: number | null;
}

/** Fetch USD prices for SOL, USDC and (if configured) the custom token. */
export async function getAssetPrices(): Promise<AssetPrices> {
  const mints = [SOL_MINT, env.usdcMint, env.tokenMint].filter(Boolean);
  try {
    // Jupiter Price API v3: GET /price/v3?ids=<mints>. Response is keyed by mint
    // with a numeric `usdPrice` (no `data` wrapper).
    const res = await fetch(
      `https://lite-api.jup.ag/price/v3?ids=${mints.join(",")}`,
      // Cache across requests so we don't hit the feed on every lobby render.
      { next: { revalidate: 60 } },
    );
    if (!res.ok) throw new Error(`price feed ${res.status}`);
    const json = (await res.json()) as Record<
      string,
      { usdPrice?: number } | null
    >;
    const priceOf = (mint: string): number | null => {
      const n = json[mint]?.usdPrice;
      return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
    };
    return {
      solUsd: priceOf(SOL_MINT),
      usdcUsd: priceOf(env.usdcMint) ?? 1,
      tokenUsd: env.tokenMint ? priceOf(env.tokenMint) : null,
    };
  } catch {
    return { solUsd: null, usdcUsd: 1, tokenUsd: null };
  }
}

/** USD price for one unit of the given asset (null if unknown). */
export function usdPriceForAsset(asset: Asset, p: AssetPrices): number | null {
  switch (asset) {
    case "SOL":
      return p.solUsd;
    case "USDC":
      return p.usdcUsd;
    case "TOKEN":
      return p.tokenUsd;
  }
}
