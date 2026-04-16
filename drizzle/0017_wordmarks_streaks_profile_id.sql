-- PR 3 of the profile-id series: wordmarks + streaks pick up the same
-- canonical identity as solves (from PR 60) and the leaderboard (from
-- PR 63). Handle-only and email-auth users can now earn wordmarks and
-- grow a streak without ever binding a wallet.
--
-- Both tables get a nullable profile_id column, a nullable wallet
-- column (downgraded from NOT NULL), a CHECK that at least one is set,
-- and a generated `player_key` = COALESCE('p:' || profile_id, wallet)
-- that drives a single unique index. Wallet-bearing rows keep showing
-- up under their address; profile-bearing rows collapse to one slot
-- per player regardless of later wallet linking.
--
-- Existing rows get backfilled from `profiles` by wallet. For any row
-- whose wallet no longer maps to a profile, wallet stays the
-- identity; for matched rows, profile_id takes over (player_key shifts
-- from the wallet string to 'p:<id>', which recomputes automatically
-- since it's a generated column).

-- ─── Wordmarks ───────────────────────────────────────────────────
--
-- No collision-cleanup DELETE here: the existing unique index on
-- (wallet, wordmark_id) already guarantees no two rows share a
-- (wallet, wordmark) pair, and pre-this-PR the wallet write gate on
-- /api/solve prevented handle-only users from earning wordmarks at
-- all — so there are no profile-keyed duplicates to collide with
-- wallet-keyed rows after backfill. A previous version of this
-- migration had a defensive DELETE, but it (a) referenced profile_id
-- before the ADD COLUMN ran and (b) defended against a state the
-- application never produced. Dropping it.

ALTER TABLE "wordmarks" ALTER COLUMN "wallet" DROP NOT NULL;

ALTER TABLE "wordmarks"
  ADD COLUMN IF NOT EXISTS "profile_id" integer REFERENCES "profiles"("id");

ALTER TABLE "wordmarks"
  ADD CONSTRAINT "wordmarks_identity_required"
  CHECK ("wallet" IS NOT NULL OR "profile_id" IS NOT NULL);

-- Backfill profile_id before adding the generated column, so the
-- computed player_key lands on the preferred value for each row from
-- the start.
UPDATE "wordmarks"
SET "profile_id" = p."id"
FROM "profiles" p
WHERE "wordmarks"."wallet" IS NOT NULL
  AND "wordmarks"."wallet" = p."wallet"
  AND "wordmarks"."profile_id" IS NULL;

ALTER TABLE "wordmarks"
  ADD COLUMN "player_key" varchar(64)
  GENERATED ALWAYS AS (COALESCE('p:' || "profile_id"::text, "wallet")) STORED;

-- Drop the wallet-scoped indexes; the new player_key ones supersede them.
DROP INDEX IF EXISTS "wordmarks_wallet_wordmark_idx";
DROP INDEX IF EXISTS "wordmarks_wallet_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "wordmarks_player_wordmark_idx"
  ON "wordmarks" ("player_key", "wordmark_id");
CREATE INDEX IF NOT EXISTS "wordmarks_player_key_idx"
  ON "wordmarks" ("player_key");

-- ─── Streaks ─────────────────────────────────────────────────────
--
-- No collision-cleanup DELETE here for the same reason as wordmarks:
-- streaks.wallet was PK, so at most one row per wallet exists today,
-- and pre-this-PR handle-only users never got a streak row written
-- (the /api/solve write gate required wallet). So no profile-keyed
-- rows exist to collide with wallet-keyed ones post-backfill.

ALTER TABLE "streaks" DROP CONSTRAINT IF EXISTS "streaks_pkey";
ALTER TABLE "streaks" ALTER COLUMN "wallet" DROP NOT NULL;

ALTER TABLE "streaks"
  ADD COLUMN IF NOT EXISTS "profile_id" integer REFERENCES "profiles"("id");

ALTER TABLE "streaks"
  ADD CONSTRAINT "streaks_identity_required"
  CHECK ("wallet" IS NOT NULL OR "profile_id" IS NOT NULL);

UPDATE "streaks"
SET "profile_id" = p."id"
FROM "profiles" p
WHERE "streaks"."wallet" IS NOT NULL
  AND "streaks"."wallet" = p."wallet"
  AND "streaks"."profile_id" IS NULL;

ALTER TABLE "streaks"
  ADD COLUMN "player_key" varchar(64)
  GENERATED ALWAYS AS (COALESCE('p:' || "profile_id"::text, "wallet")) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS "streaks_player_key_idx"
  ON "streaks" ("player_key");
