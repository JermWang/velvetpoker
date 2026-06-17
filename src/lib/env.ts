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
  depositConfirmations: Number(optional("DEPOSIT_CONFIRMATIONS") ?? "32"),
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
