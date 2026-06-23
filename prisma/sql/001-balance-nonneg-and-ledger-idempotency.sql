-- Velvet Poker — money-integrity hardening (apply to the database before launch).
--
-- This repo uses `prisma db push` (no migrations folder) and Prisma cannot express
-- CHECK constraints or partial unique indexes in schema.prisma, so apply these by
-- hand against the database (Supabase SQL editor or psql) as part of the deploy.
--
-- They are DEFENSE-IN-DEPTH backstops. The application already enforces both
-- properties (the SELECT ... FOR UPDATE lock in applyBalanceDelta, and the
-- deterministic per-hand settlement correlationId). These constraints guarantee
-- the invariants hold even if application logic ever regresses.
--
-- SAFETY: run the two SELECTs first. If either returns rows, FIX THE DATA before
-- adding the constraint, or the ALTER will fail.

-- 1) A balance bucket must never go negative (hard backstop against overdraft).
--    Pre-check (must return 0 rows):
--      SELECT * FROM "Balance"
--      WHERE "availableAmount" < 0 OR "lockedAmount" < 0 OR "referralEarningsAmount" < 0;
ALTER TABLE "Balance"
  ADD CONSTRAINT "balance_nonneg"
  CHECK (
    "availableAmount" >= 0
    AND "lockedAmount" >= 0
    AND "referralEarningsAmount" >= 0
  );

-- 2) A monetary leg can be posted at most once per (correlationId, accountType,
--    direction). This makes a replayed hand-settlement / deposit-credit a hard DB
--    error instead of a silent double-post. Plain UNIQUE(correlationId) would break
--    multi-leg transactions (a settlement posts several legs under one id), so the
--    key includes accountType + direction + userId.
--    Pre-check (must return 0 rows — existing duplicates):
--      SELECT "correlationId", "accountType", "direction", "userId", COUNT(*)
--      FROM "LedgerEntry"
--      GROUP BY "correlationId", "accountType", "direction", "userId"
--      HAVING COUNT(*) > 1;
CREATE UNIQUE INDEX "ledgerentry_idempotency"
  ON "LedgerEntry" ("correlationId", "accountType", "direction", "userId");
