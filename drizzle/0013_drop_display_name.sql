-- Collapse "display name" and "handle" into a single user-facing
-- "username" (stored in the existing `handle` column). Every current
-- profile already has a handle (set on every profile creation path),
-- so dropping display_name doesn't strand any data — the column was
-- only ever a duplicate label.

-- Safety net: if any row somehow has display_name set without a
-- handle, backfill via a best-effort slug. This shouldn't hit any
-- rows in practice but is cheap insurance against a migration crash.
UPDATE "profiles"
SET "handle" = regexp_replace(
  regexp_replace(lower("display_name"), '[^a-z0-9_]+', '_', 'g'),
  '^_+|_+$', '', 'g'
)
WHERE "handle" IS NULL AND "display_name" IS NOT NULL;
--> statement-breakpoint

ALTER TABLE "profiles" DROP COLUMN "display_name";
