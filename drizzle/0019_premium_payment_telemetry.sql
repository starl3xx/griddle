-- M5-usdc-premium: payment telemetry + escrow lifecycle tracking on
-- premium_users, feeding the new admin Transactions tab.
--
-- Crypto path (unlockWithUsdc): usdc_amount + word_burned are written
-- at verify time; the rest stay null (no escrow).
--
-- Fiat path: stripe webhook writes escrow_open_tx + external_id +
-- escrow_status='pending'. A new hourly cron (sync-escrow-burns) scans
-- EscrowBurned / EscrowRefunded events on the GriddlePremium contract
-- and flips escrow_status + fills escrow_burn_tx + word_burned.
--
-- external_id is keccak256(stripeSessionId) — matches the contract's
-- idempotency key so admin joins an on-chain event back to the DB row
-- without a scan.

ALTER TABLE "premium_users"
  ADD COLUMN IF NOT EXISTS "usdc_amount"      numeric(20, 6),
  ADD COLUMN IF NOT EXISTS "word_burned"      numeric(40, 0),
  ADD COLUMN IF NOT EXISTS "escrow_status"    varchar(12),
  ADD COLUMN IF NOT EXISTS "escrow_open_tx"   varchar(66),
  ADD COLUMN IF NOT EXISTS "escrow_burn_tx"   varchar(66),
  ADD COLUMN IF NOT EXISTS "external_id"      varchar(66);

CREATE UNIQUE INDEX IF NOT EXISTS "premium_users_external_id_idx"
  ON "premium_users" ("external_id")
  WHERE "external_id" IS NOT NULL;
