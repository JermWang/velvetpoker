-- Velvet Poker — unattributed-deposit support (apply on deploy).
--
-- Preferred: run `npx prisma db push` (the project's schema workflow) against the
-- target DB, which applies both changes from schema.prisma. This file is the
-- equivalent raw SQL if you apply changes by hand instead.
--
-- 1) Deposit.userId becomes nullable so a deposit whose on-chain sender maps to
--    no user (e.g. an exchange withdrawal) can be recorded for manual review
--    instead of dropped. Existing rows are unaffected (all currently have a user).
ALTER TABLE "Deposit" ALTER COLUMN "userId" DROP NOT NULL;

-- 2) New DepositStatus value for those records. NOTE: in PostgreSQL an enum value
--    cannot be added inside a transaction block — run this statement on its own
--    (psql/Supabase SQL editor do this fine).
ALTER TYPE "DepositStatus" ADD VALUE IF NOT EXISTS 'UNATTRIBUTED';
