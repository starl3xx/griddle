-- M6-farcaster-oracle-push: runtime config for the $WORD price pushing
-- oracle. Single-row table; see lib/db/schema.ts `oracleConfig` for the
-- full docblock. A default row is seeded here so the cron route has a
-- value to read on its first invocation (pool_id is the live
-- $WORD/WETH Clanker v4 pool on Base).
--
-- Hand-written (not drizzle-kit output) because the migration journal
-- on main is pre-existing-out-of-sync with the SQL files — running
-- `db:generate` would attempt to re-CREATE every table from 0011
-- onward. Safe to apply against a DB already at 0021.

CREATE TABLE "oracle_config" (
    "id" integer PRIMARY KEY NOT NULL,
    "pool_id" varchar(80) NOT NULL,
    "cron_enabled" boolean DEFAULT true NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    "updated_by" varchar(42)
);

-- Seed the single row. Pool id is the $WORD/WETH Clanker v4 pool on
-- Base, per GeckoTerminal. If the live pool ever migrates, edit via
-- the admin UI — no schema change required.
INSERT INTO "oracle_config" ("id", "pool_id", "cron_enabled")
VALUES (1, '0xc5db937916d2c6f96142a6886ba8b5b74e14949c9cc1080a676ab2a5eb1ea275', true);
