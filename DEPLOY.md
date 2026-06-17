# Deploying Velvet Poker (Railway)

Velvet Poker runs as **two services** that share one repo and the Supabase
database:

1. **web** — the Next.js app (`npm run build` → `npm run start`)
2. **ws** — the realtime poker WebSocket server (`npm run ws:prod`)

The database is the dedicated Supabase project (already provisioned). No Railway
Postgres is needed.

> Order matters: deploy **ws first** to get its public URL, then set
> `NEXT_PUBLIC_WS_URL` on **web** before building (it's baked in at build time).

---

## 0. Login

```bash
railway login            # opens a browser
# or, headless:
railway login --browserless   # prints a URL + pairing code to authorize
```

## 1. Create the project

```bash
railway init             # creates a project; name it "Velvet Poker"
```

## 2. Deploy the **ws** service

```bash
railway add --service ws
railway service ws
# point this service at the WS start command:
railway variables --set "RAILWAY_RUN_COMMAND=npm run ws:prod"   # or set Start Command in the dashboard
railway up
railway domain           # generate a public domain, e.g. ws-production-xxxx.up.railway.app
```

Set the **ws** service variables (Settings → Variables), or via CLI
`railway variables --set "KEY=value"`:

```
DATABASE_URL=<the Supabase pooler URL from .env>
NEXT_PUBLIC_PRIVY_APP_ID=cmq5rxao4006o0ck5sslq87nt
PRIVY_APP_SECRET=<from .env>
SOLANA_RPC_URL=<a real RPC, e.g. Helius/QuickNode for mainnet>
SOLANA_NETWORK=mainnet-beta            # or devnet
HOT_WALLET_PRIVATE_KEY=<base58 hot wallet secret>   # enables real withdrawals
USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
MIN_WITHDRAWAL_REVIEW_LAMPORTS=1000000000
DEPOSIT_CONFIRMATIONS=32
ENABLE_DEV_COMPLIANCE_APPROVAL=false   # MUST be false in production
ADMIN_WALLETS=<your Solana wallet address>   # wallet-only login has no email
```

> The ws service start command must be `npm run ws:prod` (no `--env-file`;
> Railway injects env vars into the process). Its HTTP healthcheck on `/`
> returns 200 (the server wraps the WebSocket in an HTTP server).

## 3. Deploy the **web** service

```bash
railway add --service web
railway service web
railway up
railway domain           # e.g. velvet-production-yyyy.up.railway.app
```

Set the **web** service variables — same as ws, PLUS the ws URL (use `wss://`):

```
NEXT_PUBLIC_WS_URL=wss://<ws-service-domain>
```

…and all the same secrets (DATABASE_URL, Privy, Solana, ADMIN_WALLETS, etc.).
`railway.json` already sets the web start command (`npm run start`) and
healthcheck.

If you set `NEXT_PUBLIC_WS_URL` after the first build, **redeploy web** so the
value is baked into the client bundle:

```bash
railway up
```

## 4. Migrations & seed

The schema is already applied to Supabase. For future schema changes, generate
SQL with Prisma and apply it (locally or via the Supabase SQL editor):

```bash
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > migration.sql
```

Seed (optional, dev data) is a one-off: `npx prisma db seed`.

---

## Notes / gotchas
- **Build**: Railway builds on Linux. The webpack production build of the Privy
  v3 bundle can be heavy — if it OOMs, raise the service's build resources. The
  optional-dep stubs in `next.config.mjs` resolve the cross-platform module
  errors (`@stripe/crypto`, `@farcaster/*`, etc.).
- **prisma generate** runs automatically via the `postinstall` script.
- **Hot wallet**: until `HOT_WALLET_PRIVATE_KEY` is set, the app uses the mock
  Solana provider (no real deposits/withdrawals). Setting it switches to the
  real `Web3SolanaProvider`. Fund the hot wallet for withdrawals; use a real RPC
  (the public `api.mainnet-beta.solana.com` is rate-limited).
- **Admin access**: wallet-only login has no email, so set `ADMIN_WALLETS` to
  your wallet address to reach `/admin`.
- See `PRODUCTION_TODO.md` for the remaining hardening (KMS signer, real KYC/geo
  vendors, Redis-backed multi-instance rooms) before taking real money.
