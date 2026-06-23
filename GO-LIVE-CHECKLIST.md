# Velvet Poker — Go-Live Checklist

Real-money mainnet launch. Work top to bottom. Anything in **§1 is a hard
blocker** — do not open to players until those pass.

Key facts:
- Railway project **Velvet Poker** → services **`web`** and **`ws`**
- web: https://web-production-c5fb7.up.railway.app
- ws: wss://ws-production-1de4.up.railway.app
- Hot wallet (deposits/payouts): `CmY63seVHUtSSqT52FYKi3DanxPk4htFGkcJkEv4Qf2W`
- Supabase project ref: `lnrhbglbxckjfnmqufwu`
- Network: **mainnet-beta**

---

## §1 — Hard blockers (verify BEFORE real money flows)

### 1.1 Env parity on Railway
Confirm each var is set on the **correct** service.

**`ws` service** (holds tables + on-chain workers):
- [ ] `HOT_WALLET_PRIVATE_KEY` — set (flips Mock → real Web3 Solana provider)
- [ ] `DATABASE_URL`, `SOLANA_RPC_URL` (Helius mainnet), `SOLANA_NETWORK=mainnet-beta`
- [ ] `RUN_BACKGROUND_WORKERS` **unset or `true`** (so deposit/withdrawal/reconcile run)
- [ ] `ALERT_WEBHOOK_URL` — set (see §2.1)

**`web` service**:
- [ ] `DATABASE_URL`, `NEXT_PUBLIC_WS_URL=wss://ws-production-1de4.up.railway.app`
- [ ] Privy: `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_SECRET`
- [ ] `TREASURY_WALLET_ADDRESS`
- [ ] `MAX_PRIVATE_TABLES` (optional, default 50)
- [ ] `NEXT_PUBLIC_LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (only if enabling voice/video)
- [ ] `ENABLE_DEV_COMPLIANCE_APPROVAL=true` (intentional — no KYC)

> ⚠️ `HOT_WALLET_PRIVATE_KEY` must **never** be on the `web` service or in the repo.

### 1.2 Hot-wallet float + gas
- [ ] Hot wallet funded with enough SOL to cover expected **payouts + its own tx fees**
- [ ] If running USDC/token tables, hot wallet holds enough of that asset too
- [ ] `MIN_WITHDRAWAL_REVIEW_LAMPORTS` and the daily caps
      (`WITHDRAWAL_DAILY_MAX_*`) match the float you'll auto-approve without a
      manual look. Anything at/above forces manual review — that's the safety valve.

### 1.3 One real on-chain money cycle (the single most important test)
Do this with tiny amounts the moment §1.1/§1.2 are done:
1. [ ] Sign in with a real wallet on the live site
2. [ ] **Deposit** ~0.05 SOL to your assigned deposit address → confirm it credits
       in the cashier after the configured confirmations (`DEPOSIT_CONFIRMATIONS`, default 32)
3. [ ] Take a seat at a **real** table, play **one full hand** to showdown → confirm
       stack/pot/ledger move correctly
4. [ ] **Withdraw** the balance to an external wallet → confirm a real signed tx
       lands on-chain and the ledger debits
5. [ ] Spot-check the admin risk dashboard + `LedgerEntry` rows reconcile (no orphan balance)

If all 5 pass, the deposit-attribution → ledger → signed-withdrawal path is proven.

---

## §2 — Operational readiness

### 2.0 ⚠️ GitHub auto-deploy is BROKEN on both services (blocker)
Pushing to `main` does **not** redeploy `web` or `ws` — they were both running stale
code for a long time (this is what hid the bot removal, private rake, and the live
lobby seat counts). Until fixed, every change must be shipped manually:
```bash
railway up --service ws --detach     # ws (realtime + money workers)
railway up --service web --detach    # web (Next.js)
```
- [ ] Railway → `web` service → Settings → **Source**: reconnect the GitHub repo + branch `main`, enable **"Deploy on push"**
- [ ] Same for the `ws` service
- [ ] Confirm a trivial push to `main` triggers a deploy on both
- [ ] Note: `ws` holds in-memory room state — keep it at **exactly 1 replica** (Settings → Deploy → Replicas = 1). With >1 replica, players split across instances and can't see each other. A Redis pub/sub backplane is the proper multi-replica fix (post-launch).


### 2.1 Error / crash monitoring  ⚠️ currently the weakest spot
- [ ] **Set `ALERT_WEBHOOK_URL`** on the `ws` service to a Slack or Discord webhook.
      Without it you are blind to: HIGH/CRITICAL risk events *and* ws crashes.
      (Code now posts both — risk events via `sendRiskAlert`, crashes via
      `sendOpsAlert` — but only if this URL is set.)
- [ ] Send a test ping to the webhook to confirm it reaches you.
- [ ] (Post-launch) Consider Sentry for full server/API exception tracking —
      the webhook covers risk + process crashes, not every 500.

### 2.2 Railway restart policy
- [ ] Confirm both services use **Restart: On Failure** (dashboard → service →
      Settings). The new `uncaughtException` guard exits the ws process on a fatal
      error specifically so Railway can restart it clean — that only helps if
      restart-on-failure is on.

### 2.3 Database backups
- [ ] Supabase → Project → Database → **Backups**: confirm **Point-in-Time
      Recovery** is enabled (non-negotiable for a money ledger). PITR needs at
      least the Pro plan.

---

## §3 — Token config (when you flip public/token tables on)

- [ ] Set `TOKEN_MINT` (server-only), `NEXT_PUBLIC_TOKEN_DECIMALS`,
      `NEXT_PUBLIC_TOKEN_SYMBOL` — **decimals/symbol must match the mint exactly**
- [ ] Reseed house rooms so they peg to the token price:
      `npm run seed:rooms` (uses live Jupiter price)
- [ ] Confirm the lobby shows `$20` / Velvet Room with the **token translation**
      underneath (`≈ N SYMBOL`). If Jupiter can't price the mint yet, rooms
      silently fall back to **USDC** — verify which one is actually showing.

---

## §4 — Polish (safe to do post-launch)

- [ ] Mobile optimization pass (still open)
- [ ] Optimize the chip PNG (1.1 MB → small WebP)
- [ ] LiveKit voice/video keys (if not done in §1.1)

---

### Quick reference — useful commands
```bash
# Reseed the house rooms (after token config)
npm run seed:rooms

# Tail a Railway service's logs
railway logs --service ws
railway logs --service web

# Set a variable on a service (triggers redeploy)
railway variables --service web --set KEY=value
```
