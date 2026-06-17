# Production integration TODO

This MVP is architecturally complete with **mocked chain and compliance** behind
clean interfaces. Before any real-money launch, the following must be done.
Nothing here is a shortcut left in business logic — each item is a provider/infra
swap or a hardening task.

## Legal & licensing (blocking)
- [ ] Obtain gaming counsel; confirm licensing per jurisdiction.
- [ ] Replace placeholder Terms / Privacy / Responsible Gaming with reviewed copy.
- [ ] Define and enforce the real geofence allow/deny list.

## Auth (Privy)
- [ ] Set `NEXT_PUBLIC_PRIVY_APP_ID` + `PRIVY_APP_SECRET`.
- [ ] Mount `PrivyProvider` + login UI in `/signin` (replaces `DevSignIn`).
- [ ] Persist embedded Solana wallet (`Wallet` rows, `type=EMBEDDED`).
- [ ] Remove/disable the dev sign-in route in production (already gated, verify).

## Compliance (real vendors)
- [ ] Implement a real `ComplianceProvider` (KYC e.g. Persona/Sumsub, geo-IP,
      sanctions screening) and wire it in `getComplianceProvider()`.
- [ ] Set `ENABLE_DEV_COMPLIANCE_APPROVAL=false`.
- [ ] Schedule periodic re-screening; update `User` status on results.

## Solana custody (critical)
- [ ] Implement `Web3SolanaProvider` (deposits via logs/`getSignaturesForAddress`,
      SPL token parsing for USDC, real confirmation counts).
- [ ] Deposit address management: generate per-user keypairs in a **KMS/HSM**;
      never store raw secret keys in the DB (see `wallets.ts` TODO).
- [ ] Withdrawals: sign with a **hardened signer / MPC**, not a raw env key.
      Add velocity limits, allow-listing, and double-spend/idempotency guards.
- [ ] Sweep deposit addresses → treasury; cold/hot wallet policy.

## Ledger & money
- [ ] Add DB-level constraints/triggers to forbid negative balances as defense
      in depth (app already enforces).
- [ ] Run `reconciliation` on a schedule; alert on any mismatch (CRITICAL risk).
- [ ] Decide rake policy; `settleHand`/`settleHandLedger` already support bps+cap.
- [ ] Money-movement rate limits + idempotency keys on all cashier endpoints.

## Realtime / scaling
- [ ] Back `TableRoom` registry with **Redis** for pub/sub + locks so multiple WS
      instances can serve the same table; add sticky routing or a room owner.
- [ ] Persist hands/actions/results/RngProof rows from the room (currently the
      engine runs in-memory; add a persistence hook alongside `onHandSettled`).
- [ ] Reconnect/resume protocol; spectator mode; sit-out timeout removal.
- [ ] Enforce the exact min-reraise lock for sub-minimum all-ins (engine MVP
      currently reopens action on any raise — see `applyAggressive`).

## Security & ops
- [ ] AuthZ review on every API route; rate limiting; CSRF where relevant.
- [ ] Secrets via a manager (not `.env`); rotate keys.
- [ ] Structured logging, metrics, tracing; alerting on risk + reconciliation.
- [ ] Pen test; anti-collusion model beyond the current heuristics.
- [ ] Backups + disaster recovery for Postgres; ledger is the source of truth.

## Product polish
- [ ] Oval table layout with positioned seats + dealer animations.
- [ ] Hand-history replay UI; richer cashier (deposit QR, network warnings).
- [ ] Email/notification on withdrawal status, big wins, RG nudges.
- [ ] Accessibility & full mobile pass.
