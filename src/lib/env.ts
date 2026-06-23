/**
 * Centralized, validated environment access. Server-only values must never be
 * imported into client components. Anything prefixed NEXT_PUBLIC_ is safe.
 */

function optional(key: string): string | undefined {
  const v = process.env[key];
  return v && v.length > 0 ? v : undefined;
}

function required(key: string): string {
  const v = optional(key);
  if (v === undefined) {
    // Defer hard failure to first use so the app can build without a full env
    // (e.g. during static generation / CI typecheck).
    return "";
  }
  return v;
}

export const env = {
  // Public
  privyAppId: optional("NEXT_PUBLIC_PRIVY_APP_ID") ?? "",
  wsUrl: optional("NEXT_PUBLIC_WS_URL") ?? "ws://localhost:3001",
  // LiveKit (table voice/video). URL is public (wss://…); key+secret are
  // server-only (used to mint join tokens). Empty = voice/video disabled.
  livekitUrl: optional("NEXT_PUBLIC_LIVEKIT_URL") ?? "",
  livekitApiKey: optional("LIVEKIT_API_KEY") ?? "",
  livekitApiSecret: optional("LIVEKIT_API_SECRET") ?? "",
  solanaNetwork: (optional("SOLANA_NETWORK") ?? "devnet") as
    | "mainnet-beta"
    | "devnet"
    | "testnet",

  // Server-only
  databaseUrl: required("DATABASE_URL"),
  redisUrl: optional("REDIS_URL") ?? "redis://localhost:6379",
  privyAppSecret: optional("PRIVY_APP_SECRET") ?? "",
  solanaRpcUrl: optional("SOLANA_RPC_URL") ?? "https://api.devnet.solana.com",
  hotWalletPrivateKey: optional("HOT_WALLET_PRIVATE_KEY") ?? "",
  treasuryWalletAddress: optional("TREASURY_WALLET_ADDRESS") ?? "",
  // SPL mint for USDC. Mainnet default; override for devnet/test mints.
  usdcMint:
    optional("USDC_MINT") ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  // Custom SPL token (the house token). The MINT is server-only; decimals and
  // symbol are NEXT_PUBLIC_ so the client can format/display token amounts.
  // Empty mint = token not configured yet (public/token tables are disabled
  // until it's set). Public (non-demo) tables may only use this token.
  tokenMint: optional("TOKEN_MINT") ?? "",
  tokenDecimals: Number(optional("NEXT_PUBLIC_TOKEN_DECIMALS") ?? "9"),
  tokenSymbol: optional("NEXT_PUBLIC_TOKEN_SYMBOL") ?? "TOKEN",
  adminEmails: (optional("ADMIN_EMAILS") ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  adminWallets: (optional("ADMIN_WALLETS") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  enableDevComplianceApproval:
    optional("ENABLE_DEV_COMPLIANCE_APPROVAL") === "true",
  minWithdrawalReviewLamports: BigInt(
    optional("MIN_WITHDRAWAL_REVIEW_LAMPORTS") ?? "1000000000",
  ),
  // Per-user withdrawal velocity. Exceeding the rolling-24h count OR the
  // per-asset amount cap forces the request into manual review (it never
  // hard-blocks the user). Tune for your float; defaults are conservative.
  withdrawalDailyMaxCount: Number(optional("WITHDRAWAL_DAILY_MAX_COUNT") ?? "20"),
  withdrawalDailyMaxLamports: BigInt(
    optional("WITHDRAWAL_DAILY_MAX_LAMPORTS") ?? "10000000000", // 10 SOL
  ),
  withdrawalDailyMaxUsdc: BigInt(
    optional("WITHDRAWAL_DAILY_MAX_USDC") ?? "5000000000", // 5000 USDC (6dp)
  ),
  // Custom token withdrawal gating (base units). Defaults are deliberately
  // permissive on amount (token value is unknown); the per-day count still
  // applies. Tune once the token's market value is known.
  minWithdrawalReviewToken: BigInt(
    optional("MIN_WITHDRAWAL_REVIEW_TOKEN") ?? "0", // 0 = never force review on amount alone
  ),
  withdrawalDailyMaxToken: BigInt(
    optional("WITHDRAWAL_DAILY_MAX_TOKEN") ?? "0", // 0 = no per-asset amount cap
  ),
  // Optional outbound webhook for HIGH/CRITICAL risk alerts (Slack/Discord/
  // generic JSON). Unset = alerts are recorded to the DB only.
  alertWebhookUrl: optional("ALERT_WEBHOOK_URL"),
  depositConfirmations: Number(optional("DEPOSIT_CONFIRMATIONS") ?? "32"),
  // Tolerance for the on-chain treasury reconciliation. A SHORTFALL beyond this
  // (chain balance < ledger liabilities) fires a CRITICAL alert. SOL needs a
  // buffer because tx fees + ATA rent drain lamports that the ledger doesn't
  // track; SPL (USDC/TOKEN) has no such drift so its tolerance is ~0.
  reconcileToleranceLamports: BigInt(
    optional("RECONCILE_TOLERANCE_LAMPORTS") ?? "100000000", // 0.1 SOL
  ),
  reconcileToleranceSpl: BigInt(optional("RECONCILE_TOLERANCE_SPL") ?? "0"),
  // Cap on concurrent private tables (server-overload guard). Hosting is blocked
  // with a "wait" message once this many private games are live.
  maxPrivateTables: Number(optional("MAX_PRIVATE_TABLES") ?? "50"),
  wsPort: Number(optional("WS_PORT") ?? "3001"),
  isProduction: process.env.NODE_ENV === "production",

  // Outcome anchoring. Hands are batched into a Merkle root and posted on-chain
  // in one memo tx. Anchor when a batch reaches minBatch, OR when the oldest
  // unanchored hand exceeds maxAge (so low-traffic tables still anchor in
  // bounded time). Set ANCHOR_ENABLED=false to disable.
  anchorEnabled: optional("ANCHOR_ENABLED") !== "false",
  anchorMinBatch: Number(optional("ANCHOR_MIN_BATCH") ?? "10"),
  anchorMaxBatch: Number(optional("ANCHOR_MAX_BATCH") ?? "200"),
  anchorMaxAgeMs: Number(optional("ANCHOR_MAX_AGE_MS") ?? "600000"),
  anchorIntervalMs: Number(optional("ANCHOR_INTERVAL_MS") ?? "60000"),
};

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return env.adminEmails.includes(email.toLowerCase());
}

export function isAdminWallet(address: string | null | undefined): boolean {
  if (!address) return false;
  return env.adminWallets.includes(address);
}

/** True once the custom SPL token mint is configured (token play enabled). */
export function isTokenConfigured(): boolean {
  return env.tokenMint.length > 0;
}

/** True once LiveKit is configured (table voice/video enabled). */
export function isLiveKitConfigured(): boolean {
  return (
    env.livekitUrl.length > 0 &&
    env.livekitApiKey.length > 0 &&
    env.livekitApiSecret.length > 0
  );
}
