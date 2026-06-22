/**
 * Rake: the house fee taken from each pot.
 *
 * Policy: a percentage of the pot (default 3%), hard-capped at a small multiple
 * of the big blind, and only taken when a flop is dealt ("no flop, no drop").
 * The cap is what keeps the rake fair on large pots — uncapped percentage rake
 * is the thing grinders notice and flee.
 *
 * The collected rake is split equally three ways: team revenue, token buyback
 * reserve, and the referral pool (see splitRakeThreeWays + the ledger).
 */

/** Default rake in basis points (3%). Per-table override via PokerTable.rakeBps. */
export const DEFAULT_RAKE_BPS = 300;

/** Private-table rake (2%): split 1% house treasury / 1% token buyback. */
export const PRIVATE_RAKE_BPS = 200;

/** Cap the rake at this many big blinds, regardless of pot size. */
export const RAKE_CAP_BIG_BLINDS = 3n;

export function computeRake(params: {
  pot: bigint;
  rakeBps: number;
  bigBlind: bigint;
  /** Whether a flop was dealt — no flop, no drop. */
  flopSeen: boolean;
}): bigint {
  if (!params.flopSeen) return 0n;
  if (params.rakeBps <= 0 || params.pot <= 0n) return 0n;
  const raw = (params.pot * BigInt(params.rakeBps)) / 10_000n;
  const cap = params.bigBlind * RAKE_CAP_BIG_BLINDS;
  return raw < cap ? raw : cap;
}

/**
 * Split a rake amount into three equal parts (team / buyback / referral). The
 * house (team) absorbs any rounding remainder so referrers are never over-credited.
 */
export function splitRakeThreeWays(rake: bigint): {
  team: bigint;
  buyback: bigint;
  referral: bigint;
} {
  const buyback = rake / 3n;
  const referral = rake / 3n;
  const team = rake - buyback - referral; // remainder stays with the house
  return { team, buyback, referral };
}

/**
 * Private-table rake split: half to the house treasury (team), half to the
 * token buyback reserve. No referral cut. The house absorbs the rounding
 * remainder (odd base unit).
 */
export function splitRakePrivate(rake: bigint): {
  team: bigint;
  buyback: bigint;
} {
  const buyback = rake / 2n;
  const team = rake - buyback; // remainder stays with the house
  return { team, buyback };
}
