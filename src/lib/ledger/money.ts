/**
 * Money primitives for Velvet Poker.
 *
 * HARD RULES (enforced by code review and tests):
 *  - Money is NEVER represented as a JS `number` (float). All amounts are `bigint`.
 *  - SOL is stored as lamports          (1 SOL  = 1_000_000_000 lamports).
 *  - USDC is stored as base units       (1 USDC = 1_000_000 base units, 6 decimals).
 *  - Parsing from a human string is the ONLY place decimals appear, and it is
 *    done with integer string math so there is no floating point intermediary.
 */

export type Asset = "SOL" | "USDC" | "TOKEN";

// Custom token decimals/symbol come from NEXT_PUBLIC_ env so this module works
// identically on the server and in the client bundle (Next inlines NEXT_PUBLIC_
// at build time). Defaults keep dev/tests working before the token is set.
const TOKEN_DECIMALS =
  Number(process.env.NEXT_PUBLIC_TOKEN_DECIMALS ?? "9") || 9;
export const TOKEN_SYMBOL = process.env.NEXT_PUBLIC_TOKEN_SYMBOL || "TOKEN";

export const ASSET_DECIMALS: Record<Asset, number> = {
  SOL: 9,
  USDC: 6,
  TOKEN: TOKEN_DECIMALS,
};

/** Display ticker for an asset (SOL/USDC literal; TOKEN uses the configured symbol). */
export const ASSET_SYMBOLS: Record<Asset, string> = {
  SOL: "SOL",
  USDC: "USDC",
  TOKEN: TOKEN_SYMBOL,
};

export const LAMPORTS_PER_SOL = 1_000_000_000n;
export const BASE_UNITS_PER_USDC = 1_000_000n;

/** Thrown when a human-entered amount cannot be parsed safely. */
export class MoneyParseError extends Error {}

/**
 * Generic decimal-string -> integer base units, done purely with string/BigInt
 * math (no Number()), so values like "0.1" never touch IEEE-754.
 */
function parseDecimalToBaseUnits(input: string, decimals: number): bigint {
  const trimmed = input.trim();
  if (trimmed === "") throw new MoneyParseError("Amount is empty");
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new MoneyParseError(`Invalid amount: "${input}"`);
  }

  const [whole, frac = ""] = trimmed.split(".");
  if (frac.length > decimals) {
    throw new MoneyParseError(
      `Too many decimal places: max ${decimals} for this asset`,
    );
  }

  const paddedFrac = frac.padEnd(decimals, "0");
  const combined = `${whole}${paddedFrac}`.replace(/^0+(?=\d)/, "");
  return BigInt(combined === "" ? "0" : combined);
}

/**
 * Generic integer base units -> human decimal string, trimming trailing zeros
 * but keeping at least the whole part. Pure BigInt math.
 */
function formatBaseUnitsToDecimal(amount: bigint, decimals: number): string {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const divisor = 10n ** BigInt(decimals);
  const whole = abs / divisor;
  const frac = abs % divisor;

  let fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  const body = fracStr === "" ? `${whole}` : `${whole}.${fracStr}`;
  return negative ? `-${body}` : body;
}

// ---- SOL -------------------------------------------------------------------

export function parseSolToLamports(sol: string): bigint {
  return parseDecimalToBaseUnits(sol, ASSET_DECIMALS.SOL);
}

export function formatLamportsToSol(lamports: bigint): string {
  return formatBaseUnitsToDecimal(lamports, ASSET_DECIMALS.SOL);
}

// ---- USDC ------------------------------------------------------------------

export function parseUsdcToBaseUnits(usdc: string): bigint {
  return parseDecimalToBaseUnits(usdc, ASSET_DECIMALS.USDC);
}

export function formatBaseUnitsToUsdc(baseUnits: bigint): string {
  return formatBaseUnitsToDecimal(baseUnits, ASSET_DECIMALS.USDC);
}

// ---- Asset-generic helpers -------------------------------------------------

export function parseAmount(asset: Asset, human: string): bigint {
  return parseDecimalToBaseUnits(human, ASSET_DECIMALS[asset]);
}

export function formatAmount(asset: Asset, amount: bigint): string {
  return formatBaseUnitsToDecimal(amount, ASSET_DECIMALS[asset]);
}

/** Human-friendly label, e.g. "1.5 SOL", "25 USDC", or "100 VELVET". */
export function formatAmountWithSymbol(asset: Asset, amount: bigint): string {
  return `${formatAmount(asset, amount)} ${ASSET_SYMBOLS[asset]}`;
}

/** Clamp helper used by betting math; all inputs/outputs are bigint. */
export function clampBig(value: bigint, min: bigint, max: bigint): bigint {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function maxBig(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

export function minBig(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}
