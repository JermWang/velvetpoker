# Velvet Poker — Pre-Launch Audit (2026-06-23)

> Expert full-codebase audit run hours before the real-money mainnet go-live.
> Method: 10 parallel review dimensions → every finding adversarially re-verified against the actual code (skeptic tries to *refute* before it counts) → synthesized.
> **42 confirmed findings · 9 launch blockers · verdict below.**

## ⏱️ Status — fixes applied this session (2026-06-23)

**Code blockers 1–7 fixed, verified (typecheck + build + 73 tests green). Transparency + mobile also done.**

| Item | Status |
|------|--------|
| 1 — Overdraft race | ✅ FIXED — `SELECT … FOR UPDATE` lock in `applyBalanceDelta` (also closes the referral double-claim race) |
| 2 — Folded hole-card leak | ✅ FIXED — `settleHand` redacts to non-folded showdown players + table-room hardened + regression test |
| 3 — Uncalled-bet chip destruction | ✅ FIXED — `refundUncalledBet` + no-eligible-pot refund backstop + chip-conservation test |
| 4 — Lone-actor re-prompt | ✅ FIXED — run the board out when ≤1 can act |
| 5 — Buy-in strands funds | ✅ FIXED — `sit()` returns success; refund the lock on seating failure |
| 6 — Leave destroys stack | ✅ FIXED — cash out before vacating, sit-out guards the await, restore on failure |
| 7 — Deposit scan loses funds | ✅ FIXED — paged signature scan w/ RPC cursor + independent re-check of pending deposits |
| 8 & 9 — Compliance | ⚪ ACCEPTED AS-IS — deliberate no-KYC decision; documented accepted risk (no code change) |
| Transparency (Solscan, verify-404, anchor proof, rake) | ✅ DONE — Solscan links on all tx; verify endpoint accepts live+history ids; anchor proof rendered; rake shown |
| Mobile landscape collapse | ✅ FIXED — side-by-side felt/panel in landscape + scrollable side panel |

### 🔴 MUST DO ON DEPLOY (not yet applied — needs DB access)
1. **Apply `prisma/sql/001-balance-nonneg-and-ledger-idempotency.sql`** to the production DB (Supabase SQL editor). It adds the non-negative-balance CHECK constraint and the ledger idempotency unique index — the DB-level backstops behind the overdraft + idempotency fixes. Run the two pre-check SELECTs first.
2. **Apply the deposit schema change** — run `npx prisma db push` against prod (preferred), or `prisma/sql/002-deposit-unattributed.sql` by hand. Makes `Deposit.userId` nullable + adds the `UNATTRIBUTED` status (required by the new deposit-attribution code; the app will error on unattributed deposits without it).
3. Set **`RUN_BACKGROUND_WORKERS=false` on the ws Railway service** (run workers separately). NOTE: a local `npm run ws` with the real `.env` runs the mainnet workers from your machine — don't.
4. Confirm `ENABLE_DEV_COMPLIANCE_APPROVAL` matches your intent on Railway (you chose to keep auto-approve).

### ✅ Systemic gaps fixed (second pass)
- **WS-crash recovery** — table rooms now rebuild seats from the ledger on startup (`reconstructSeatedStacks` → `restoreSeats`), so locked funds are never stranded after a restart; an interrupted hand is voided (ledger never settled it). +4 regression tests.
- **Money-failure alerting** — `sendOpsAlert` now fires on: hand-settlement ledger write failure (CRITICAL — stacks diverge from ledger), hand-completion persistence failure, cash-out failure, buy-in-refund failure, withdrawal send→FAILED, and seat-restore failure. (Reconciliation mismatch + ws crash already alerted.)
- **Correction:** the audit's "withdrawal-processor retries forever" was inaccurate — `sendApprovedWithdrawal` already moves a failed send to terminal `FAILED` (refunding the balance), so it is never re-picked. Now also alerts once on that transition.

### ✅ Systemic gaps fixed (third pass)
- **On-chain treasury reconciliation (HIGH)** — `reconcileTreasuryOnChain()` compares the real chain balance of the treasury (SOL + USDC + TOKEN) against ledger liabilities (`treasuryExpectedOnChain` = TREASURY_CASH debits − credits) every 5 min, CRITICAL-alerting on any shortfall beyond tolerance. New `SolanaProvider.getOnChainBalance`. Gated to the real provider.
- **Deposit attribution (HIGH)** — sender is now resolved by the **value source** (largest SOL debit / the SPL source-account owner), not the fee payer, so relayer/multisig/most direct sends attribute correctly. Sends that still map to no user (e.g. exchange withdrawals) are recorded once as `UNATTRIBUTED` deposits + HIGH risk alert (never dropped), and `assignUnattributedDeposit()` lets an admin attribute + credit them. The admin Deposits page flags them.

### ⚠️ STILL OPEN (verify/decide before or right after launch)
- `RUN_BACKGROUND_WORKERS=false` on the ws Railway service (deploy config — see above).
- Abandoned-real-money-seat timeout (a disconnected player's seat is held indefinitely).
- True CEX-deposit auto-attribution needs a product change (per-user deposit memo or per-user addresses) — current handling is manual admin assignment.
- Optional: HALT dealing (not just alert) when settlement fails repeatedly.

---

## Build health (baseline)
- ✅ `tsc --noEmit` — clean
- ✅ `vitest` — 71/71 passing (poker evaluator, hand, side-pots, RNG, ledger, money, anchoring, ws-ticket)
- ⚠️ ESLint not configured (`next lint` is unconfigured) — no static lint gate

---

## 1. Verdict: 🔴 NO-GO

**Do not take real money in a few hours.** There are **9 confirmed launch blockers**, including:
- money created from nothing via a balance race (`balance-overdraft-race`),
- folded players' hole cards broadcast to the whole table (`showdown-folded-holecards-leak`),
- real chips destroyed on ~4% of all-in hands (`uncalled-overbet-not-refunded-chip-leak`),
- and a compliance config that opens unlicensed real-money play to sanctioned jurisdictions (`compliance-provider-always-mock` + `dev-compliance-approval-on-mainnet-env`).

Several are triggerable by an ordinary player or two browser tabs — **no modified client required**. Launching now risks direct theft of treasury funds, destruction of player funds, a provable-cheating vector, and regulatory/OFAC exposure.

**Minimum bar to flip to GO:** all 9 blockers fixed and re-tested, plus the crash-recovery gap (Systemic Gap 1) addressed. Realistically more than "a few hours" of work — **hold the launch.**

---

## 2. 🛑 LAUNCH BLOCKERS

### BLOCKER 1 — Concurrent debits overdraft a balance (money from nothing) · CRITICAL
**`balance-overdraft-race`** · `src/lib/ledger/ledger.ts:64,73,103`; `prisma/schema.prisma:278`
`applyBalanceDelta()` is a read-modify-write inside a `$transaction` with **no isolation level** (READ COMMITTED), **no `SELECT ... FOR UPDATE`**, no version column, no DB `CHECK(>=0)`. Two concurrent debits both read `available=X`, both pass the `X-amount>=0` guard, both write `X-amount`.
**Exploit:** two browser tabs fire two debiting actions at once (buy in at two tables, or buy-in + withdrawal, or two withdrawals). Extra chips become a real winnable/withdrawable stack, or the second withdrawal sends real SOL/USDC they don't have → **treasury theft on no-KYC mainnet.**
**Fix:** pessimistic lock at the top of `applyBalanceDelta` (`SELECT * FROM "Balance" WHERE "userId"=$1 AND "asset"=$2 FOR UPDATE`) or SERIALIZABLE+retry; **and** a DB backstop:
```sql
ALTER TABLE "Balance" ADD CONSTRAINT balance_nonneg
  CHECK ("availableAmount" >= 0 AND "lockedAmount" >= 0 AND "referralEarningsAmount" >= 0);
```

### BLOCKER 2 — Folded players' hole cards broadcast to the whole table · CRITICAL
**`showdown-folded-holecards-leak`** · `src/lib/realtime/table-room.ts:744-758` (persist at `:857`); `src/lib/poker/showdown.ts:73-90`; `src/lib/poker/hand.ts:407-418`
`contested` = `results.length > 1`, but `settleHand` emits a results row carrying real `holeCards` for **every** seat that committed chips, including folded muckers. In any 3+ contributor pot where someone folds and 2+ show, the folded player's real cards go out over the SHOWDOWN broadcast to every client and are persisted to `HandResult.cards`.
**Exploit:** a modified client reads mucked cards of folded opponents on every multi-way pot — ongoing informational edge.
**Fix:** carry `hasFolded` onto each result; in the SHOWDOWN map emit `cards: (shownDown && !r.hasFolded) ? r.cards : []` where `shownDown = results.filter(r=>!r.hasFolded).length >= 2`; recompute `contested` from non-folded count; apply the same to the persistence path. Test: A raises, B&C call, C folds flop, A&B show → C's cards must not appear on the wire or in `HandResult`.

### BLOCKER 3 — Uncalled overbet not refunded; chips destroyed if over-raiser folds · HIGH
**`uncalled-overbet-not-refunded-chip-leak`** · `src/lib/poker/hand.ts:278,317`; `src/lib/poker/showdown.ts:48`; `src/lib/poker/side-pots.ts:36`
No uncalled-bet refund exists. Raising above what an all-in opponent can call creates a side-pot layer with `eligibleSeats=[]` if the raiser folds; `settleHand` does `if (winners.length===0) continue;` and silently drops the chips.
**Deterministic repro:** 3 players SB1/BB2, stacks 193/229/82: fold s0; s1 raise→4; s2 all-in 82; s1 raise→160 (78 uncalled); s1 fold → 78 chips destroyed (504→426). Fuzz: ~4.3% of all-in hands. `sum(amountWon) < totalPot` → settlement deltas no longer net to `-rake` → `assertBalanced` throws → DB settlement fails while the live game continues, diverging in-memory stacks from the ledger.
**Fix:** refund the uncalled excess when a betting round closes (highest `committedThisStreet` exceeds second-highest → return difference, reduce `committedTotal` before building pots); **and** in `settleHand` refund any no-eligible-seat layer to its sole contributor. Add this to the chip-conservation test suite.

### BLOCKER 4 — Engine prompts lone non-all-in player instead of running the board out · MEDIUM (enabler of #3)
**`lone-actor-prompted-after-allins`** · `src/lib/poker/hand.ts:63,71,317`
`progress()`/`nextToAct()` end a round only when no seat owes a call, never checking whether >1 player can still act. With all opponents all-in, the lone chip-holder is re-prompted each street — manufacturing the fold-after-overbet that triggers #3. The existing `ableToAct()` helper is dead code written for exactly this.
**Fix:** in `progress()`, after fold/showdown checks, treat the round complete when `ableToAct(state).length <= 1` and nobody owes a call, then run the board out.

### BLOCKER 5 — Buy-in locks funds before seating; seat failure strands locked chips · HIGH
**`buyin-locks-before-seating-leak`** · `src/lib/realtime/server.ts:291,305,310`; `src/lib/realtime/table-room.ts:224,228`
`lockBuyIn()` moves funds → TABLE_LOCKED **before** the seat is acquired. If the table is full or `sit()` races, the handler errors without unlocking — funds stuck with no seat.
**Exploit:** buy into a full table or race two BUY_IN messages.
**Fix:** acquire the seat first, lock after; make `TableRoom.sit()` return success so the caller can `cashOutSeat`-refund on failure.

### BLOCKER 6 — LEAVE_TABLE removes seat before settling; cash-out failure strands stack · HIGH
**`cashout-after-seat-removal-loss`** · `src/lib/realtime/server.ts:387,395,402`; `src/lib/realtime/table-room.ts:267`
`room.leave()` deletes the seat first; `cashOutSeat()` runs after as a separate transaction. If it throws, the catch only logs — seat gone, funds stay locked, balance never credited. No retry/compensation; repair script refuses non-`dev:` accounts.
**Fix:** `cashOutSeat` first, `leave` only on success; on failure re-seat or persist a pending cash-out. (The `isInActiveHand` gate makes the stack stable at leave time, so reordering is safe.)

### BLOCKER 7 — Deposit monitor scans only latest 40 signatures, no cursor — deposits silently lost · HIGH
**`deposit-scan-window-loses-funds`** · `src/lib/solana/deposits.ts:92-97`; `src/lib/solana/web3-provider.ts:41,83-90`; `src/lib/jobs/deposit-monitor.ts:19-32`
`getIncomingTransfers(treasury)` has no `sinceSlot`; provider hard-codes `limit: 40`. No persisted high-water cursor. A DETECTED deposit must survive in the latest-40 window the ~13-25s it needs to reach 32 confirmations; if >40 treasury txs land in that window it scrolls out and is **never credited**. No on-chain reconciliation net.
**Fix:** persist a per-address high-water mark; page backwards with `before`/`until` until caught up; don't advance the cursor past sub-confirmation signatures; alert on a full page (backlog).

### BLOCKER 8 — Compliance/geofence provider hardcoded to MOCK · HIGH (compliance)
**`compliance-provider-always-mock`** · `src/lib/compliance/gates.ts:13-15`; `mock-provider.ts:24-54`; `src/app/api/account/route.ts:36-52`
`getComplianceProvider()` always returns the mock — no env switch to a real vendor (unlike Solana). Blocks only KP/IR/SY/CU + 3 US states, keyed off a **client-supplied** `country`. Age = self-attestation.
**Fix:** wire a real provider (IP geo + sanctions) behind an env switch, **or** accept the risk in writing with legal sign-off. At minimum derive geo from server IP, never the client `country`.
*(Note: per project memory, no-KYC was a deliberate decision — but the geo/sanctions screening being keyed off a spoofable client field and the mock having no prod switch is the real issue. Confirm posture with legal before exposing funds.)*

### BLOCKER 9 — `ENABLE_DEV_COMPLIANCE_APPROVAL=true` in the mainnet `.env` · HIGH (compliance)
**`dev-compliance-approval-on-mainnet-env`** · `.env`; `mock-provider.ts:28-45`; `src/lib/env.ts:60-61`
The launch `.env` (mainnet, real hot wallet) also auto-approves geo+KYC for every non-blocklisted country. `.env.example` says this MUST be false in prod. This is what makes #8 actively exploitable today instead of fail-closed.
**Fix:** set `false`/unset in every non-dev env and verify Railway `web`/`ws`; harden in code to ignore the flag when `SOLANA_NETWORK=mainnet-beta` or `NODE_ENV=production`.

---

## 3. 🔥 Systemic gaps (lifecycle/ops — found by the completeness critic, NOT in the 9 above)

These are arguably as dangerous as the blockers and need manual verification in the remaining time. Authoritative chip state lives in **WS process memory** and only reaches the durable ledger at hand completion.

1. **WS process crash = total in-flight chip loss.** `TableRoom` holds authoritative stacks in RAM; `server.ts` does `process.exit(1)` on any uncaught exception. Buy-ins lock funds to a `tableId` in the ledger but the *stack* is only in memory. Crash mid-hand → funds stuck in `tableLocked` with no seat and **no reconciliation back to players**. **Test: `kill -9` the ws process mid-hand and confirm what happens to locked buy-in funds.** This may be the single biggest money-loss vector.
2. **Settlement is fire-and-forget.** `onHandSettled` is `void`-called; if `settleHandLedger` throws, it's caught/logged and **the next hand deals anyway** with already-mutated in-memory stacks. No retry/outbox/"stop dealing on settlement failure."
3. **Disconnect/abandoned real-money seats.** No idle-seat timeout — a disconnected player's chips lock forever. Verify a disconnected all-in player is still paid at showdown.
4. **Sit-out / action-timeout abuse** — no consecutive-timeout limit; one account can stall every hand across many tables.
5. **WS DoS / unbounded growth** — no per-IP/user connection cap (each connection = a DB query); `rooms` map never evicts; `/occupancy` is unauthenticated with `ACAO: *`; unbounded `early[]` pre-auth message buffer.
6. **No alerting on money-critical events** — settlement failure, reconciliation mismatch, withdrawal-send failure, hot-wallet low balance all die in stdout.
7. **Withdrawal queue** retries a failing withdrawal **forever** (no max-attempts / FAILED transition / backlog alarm).
8. **Workers co-located with WS** — verify Railway sets `RUN_BACKGROUND_WORKERS=false` on the ws service so a table-room crash doesn't halt deposits/withdrawals.
9. **DB-level guards must ship in the migration** — the two CRITICAL ledger findings need `UNIQUE(correlationId-or-key)` + row-lock/version on `Balance`, not just app code.
10. **Supply chain** — pin/audit `ws`, `@solana/web3.js`, Privy, Prisma; `npm ci` in CI; `npm audit`. The process holds `HOT_WALLET_PRIVATE_KEY`.

---

## 4. ⚠️ High-priority (fix today / first 24h)

- **`ledger-no-idempotency-key`** (`schema.prisma:311`, `ledger.ts:27`, `persistence.ts:83-87`) — `correlationId` indexed not unique; first retry/replay/manual re-settle double-credits the full pot+rake, invisible to reconciliation. Add a composite unique idempotency key (plain `@@unique(correlationId)` breaks multi-leg postings) + deterministic per-hand settlement key.
- **`reconciliation-not-onchain`** (`jobs/reconciliation.ts:11-38`) — only checks cache-vs-ledger; never reads chain. Hot-wallet theft / half-withdrawal / missed deposit are undetectable. Add true treasury reconciliation (on-chain SOL+SPL vs liabilities + reserves ± in-flight), CRITICAL on drift. Your only tripwire on a live hot wallet.
- **`deposit-attribution-by-fee-payer`** (`web3-provider.ts:108-153`) — sender = `accountKeys[0]` (fee payer), so **CEX withdrawals** (likely #1 funding path), relayers, multisigs get dropped/uncredited. Attribute by negative-lamport-delta (SOL) / source token-account owner (SPL); add an admin tool to assign unattributed deposits.
- **`verify-drawer-wrong-handid-404`** (`poker-table-view.tsx:367`, `api/hands/[handId]/verify/route.ts:17`) — verify drawer passes `tableId:handNumber` but the route looks up by cuid → provable-fairness silently 404s for every live hand (blank drawer). Broadcast the real `Hand.id` or accept the composite form via the existing `@@unique([tableId, handNumber])`; surface errors.

---

## 5. Medium / Low / Hardening

**Money-integrity races (medium):** `referral-claim-double-claim-race` / `referral-claim-race` (concurrent claims double-credit referral earnings — conditional `UPDATE ... WHERE referralEarnings=<read> RETURNING` + deterministic correlationId); `concurrent-buyin-orphans-locked-funds`; `withdrawal-settle-crash-leaves-sending` (persist signature before settle; chain-check recovery; never blind re-send); `settlement-missing-seat-unbalances`.

**API / auth (medium/low):** `rate-limit-xff-spoof` (limiter trusts leftmost `X-Forwarded-For` → invite-code brute force; use platform-verified IP + key money endpoints on `user.id`); `ws-ticket-fallback-secret` (HMAC falls back to a public constant if `PRIVY_APP_SECRET` unset on ws — refuse empty secret in prod); `ws-ticket-replayable-within-ttl` (add single-use nonce); `admin-routes-no-rate-limit`; `admin-role-never-downgraded`.

**Risk/abuse (medium):** `collusion-detection-dead-code` (`risk/collusion.ts` is never invoked — zero runtime collusion/multi-account detection at launch); `referral-self-farming` (self-referred alt recoups 1/3 of own rake, undetected).

**Transparency (low) — your stated requirement is unmet:** `no-solscan-links-anywhere` (deposit/withdrawal/anchor signatures never surfaced); `anchor-proof-and-explorer-never-rendered` (Merkle inclusion proof computed server-side but never shown); `explorer-url-not-solscan` (uses explorer.solana.com); `rake-not-shown-in-player-history`. Data exists — surface it with `https://solscan.io/tx/${sig}` (+ `?cluster=devnet` off mainnet).

**Mobile/UX (medium/low):** `landscape-felt-collapse` (RotatePrompt pushes landscape, but side-by-side only at `lg`/1024px → felt crushed to ~60-100px on landscape phones when it's your turn; switch to `md:flex-row`/landscape query + min-height + scroll); `portrait-mobile-felt-tight`; `header-balancepill-overflow`; `history-table-no-scroll-wrapper`.

**Config/secrets (low/info):** `helius-rpc-api-key-in-url` (rotate the Helius key before launch, restrict by origin/IP); `no-fail-fast-on-missing-critical-env` + `mainnet-rpc-network-mismatch-not-validated` (add `assertEnv()` at startup — note `SOLANA_NETWORK` doesn't route tx, only `SOLANA_RPC_URL` does); `no-security-headers-csp` (add frame-ancestors/HSTS/nosniff/CSP in `next.config.mjs`).

---

## 6. Per-area readiness

| Area | Status | One-line |
|---|---|---|
| Wallet / Auth | 🟡 YELLOW | Privy binding sound; WS-ticket fallback secret + replay window need hardening (misconfig-gated). |
| Gameplay & payouts | 🔴 RED | Uncalled-overbet chip destruction (~4% of all-in hands) + lone-actor prompt corrupt settlement. |
| Money / Ledger | 🔴 RED | Overdraft race conjures money; buy-in/leave ordering strands funds; no idempotency backstop. |
| Solana funds | 🔴 RED | 40-signature deposit window loses deposits; attribution drops CEX deposits; no on-chain reconciliation. |
| Realtime / Anti-cheat | 🔴 RED | Folded hole cards broadcast on multi-way pots; zero runtime collusion detection. |
| History / Transparency | 🟡 YELLOW | Provable-fairness drawer 404s on live hands; no Solscan links; anchor proof never rendered. |
| Mobile / UX | 🟡 YELLOW | Landscape (the orientation the app pushes) crushes the felt; portrait/header cramped. No money impact. |
| API security | 🟡 YELLOW | Rate limiter bypassable via spoofed XFF; money paths have independent server-side guards. |
| Risk / Compliance | 🔴 RED | Mock compliance provider + dev-approval flag ON in mainnet env = no real geo/sanctions screening. |
| Config / Secrets | 🟡 YELLOW | Rotate shared Helius key; add fail-fast env validation + security headers. |

**Bottom line: 5 of 10 areas RED.** Fix the 9 blockers + crash-recovery, re-run the engine fuzz asserting chip conservation, confirm compliance with legal. **Hold the launch.**
