-- Add a canonical profile identity column to solves so handle-only
-- and email-auth users (who may never bind a wallet) can see their
-- own solves in stats. Nullable FK; wallet stays authoritative for
-- already-attributed rows and is unchanged.

ALTER TABLE "solves"
  ADD COLUMN IF NOT EXISTS "profile_id" integer REFERENCES "profiles"("id");

-- Composite index backing profile-keyed stats / future leaderboard +
-- wordmarks work. Mirrors the puzzle_id+server_solve_ms pattern.
CREATE INDEX IF NOT EXISTS "solves_profile_solve_ms_idx"
  ON "solves" ("profile_id", "server_solve_ms");

-- One-shot backfill for rows whose wallet can be resolved to an
-- existing profile. This catches the vast majority of past solves.
-- Handle-only rows (wallet null, profile binding in Upstash not
-- queryable from SQL) stay NULL; getProfileStats matches them via
-- the session_id fallback until the owning user solves again and
-- writes a fresh row with profile_id populated.
UPDATE "solves"
SET "profile_id" = p."id"
FROM "profiles" p
WHERE "solves"."wallet" IS NOT NULL
  AND "solves"."wallet" = p."wallet"
  AND "solves"."profile_id" IS NULL;
