# Velvet Poker

> Internal placeholder brand. Kept easy to rename — see `src/components/brand.tsx`.

A private, elegant, **real-money Solana poker room**: Texas Hold'em cash games
with custodial balances, an internal double-entry ledger, a verifiable
(commit-reveal) shuffle, server-authoritative gameplay, and a compliance/risk
foundation.

**No smart contracts. No Anchor. No NFTs. No on-chain poker engine.** Deposits
and withdrawals settle on Solana; everything else is server-side and ledgered.

---

## Stack

- **Next.js (App Router) + TypeScript + Tailwind** — web app & API routes
- **Prisma + PostgreSQL** — persistence
- **Redis** — table locks / pub-sub (wired via `REDIS_URL`; see TODO)
- **WebSockets** (`ws`) — realtime gameplay, a **standalone process**
- **Privy** — auth + embedded Solana wallets
- **@solana/web3.js** — deposit monitoring & withdrawals (mocked in dev)
- **Vitest** — engine & money unit tests

## Money rules (non-negotiable)

- Money is **never** a float. SOL = **lamports** (`bigint`), USDC = **base units** (`bigint`).
- All balance changes go through the **ledger** (`src/lib/ledger`) inside a DB
  transaction. Nothing mutates `Balance` directly.
- Every ledger transaction is **balanced** (sum of credits == debits) — money is
  conserved. The reconciliation job proves cached balances match the ledger.

---

## Project layout

```
src/
  app/                 # routes: marketing, /signin, /app/*, /admin/*, /api/*
  components/          # marketing, app-shell, poker, cashier, lobby, host, admin, ui
  lib/
    auth/              # Privy verify, session, require-user/admin, audit
    compliance/        # provider interface + mock provider + real-money gates
    db/                # Prisma client singleton
    ledger/            # money.ts (bigint), entries.ts, ledger.ts (the ONLY balance mutator)
    poker/             # PURE engine: types, rng (shuffle proof), evaluator,
                       #   actions, side-pots, hand state machine, showdown
      tests/           # vitest suites
    realtime/          # event contracts, TableRoom, standalone WS server, client hook
    risk/              # risk events + collusion heuristics
    solana/            # chain provider interface + mock, deposits, withdrawals, wallets
    jobs/              # deposit-monitor, withdrawal-processor, reconciliation
prisma/                # schema.prisma + seed.ts
```

---

## Getting started

### 1. Prerequisites

- Node 20+
- PostgreSQL (local or hosted)
- Redis (optional for the MVP single-process dev flow)

### 2. Install & configure

```bash
npm install
cp .env.example .env     # fill in DATABASE_URL at minimum
```

In development you can leave Privy/Solana blank — the app uses a **dev sign-in**
and **mock chain/compliance** providers. Keep `ENABLE_DEV_COMPLIANCE_APPROVAL=true`
to auto-approve KYC/geo locally (this flag lives only at the provider boundary).

### 3. Database

```bash
npm run prisma:generate
npm run prisma:migrate        # creates tables (dev)
npm run prisma:seed           # admin + alice/bob, funded via ledger, one table
```

### 4. Run

```bash
npm run dev        # Next.js on :3000
npm run ws         # realtime poker server on :3001 (separate terminal)
```

Open http://localhost:3000 → **Enter** → sign in with any email
(`alice@example.com` is pre-seeded). Sign in with the admin email from
`ADMIN_EMAILS` to reach `/admin`.

### 5. Tests & checks

```bash
npm test           # vitest: engine + money (41 tests)
npm run typecheck  # tsc --noEmit
```

---

## How the core flow works

1. **Sign in** → `User` upserted (Privy in prod, dev cookie locally).
2. **Cashier** → deposit address assigned; the **deposit monitor** credits the
   ledger after confirmations (idempotent on tx signature). Withdrawals lock
   funds and route to auto-approve or admin review by threshold.
3. **Host / Lobby** → create or join a `PokerTable`.
4. **Table** → the browser opens a WebSocket to the realtime server. `BUY_IN`
   locks `available → table-locked` via the ledger, then seats you.
5. **Play** → the **pure engine** runs the hand. Before each hand the server
   publishes `sha256(serverSeed)`; after, it reveals `serverSeed` so anyone can
   recompute the deck (**Verify hand** drawer / `/api/hands/[id]/verify`).
6. **Settle** → pots are awarded by the engine; `onHandSettled` posts balanced
   per-player deltas to the ledger.
7. **Cash out / Withdraw** → table-locked → available → on-chain.
8. **Admin** → users, ledger, deposits, withdrawals, tables, hands, risk; with
   audit logging on every privileged action.

## Verifiable shuffle

Algorithm id `velvet-shuffle-sha256-fy-v1`: a SHA-256 keystream over
`serverSeed | tableId | handId | sortedClientSeeds` drives an unbiased
Fisher–Yates shuffle (rejection sampling). Commit = `sha256(serverSeed)`
published pre-deal; reveal = `serverSeed` post-hand. See `src/lib/poker/rng.ts`
and `src/lib/poker/tests/rng.test.ts`.

## Compliance & responsible gaming

`evaluateRealMoneyGates(user)` is the single decision point for real-money play
(status, KYC, geofence, age, self-exclusion). Vendors sit behind
`ComplianceProvider`; the mock is dev-only. Users can set deposit limits and
self-exclude from **Account**.

> This software does not represent that real-money play is lawful in any
> particular jurisdiction. Legal review and licensed providers are required
> before any production launch. See `PRODUCTION_TODO.md`.
