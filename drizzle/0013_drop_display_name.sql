-- Collapse "display name" and "handle" into a single user-facing
-- "username" (stored in the existing `handle` column). Every current
-- profile already has a handle (set on every profile creation path),
-- so dropping display_name doesn't strand any data — the column was
-- only ever a duplicate label.

-- Safety net: if any row somehow has display_name set without a
-- handle, backfill via a best-effort slug. Truncate to 32 chars
-- (the handle column's varchar limit) and NULLIF the result if
-- stripping non-alphanumerics left an empty string — a null handle
-- is safer than an empty one (the CHECK constraint + unique index
-- would reject '' anyway). Rows where display_name was all emoji
-- or all punctuation get null and remain handle-less, which is the
-- same state they'd be in if the user never typed anything.
UPDATE "profiles"
SET "handle" = NULLIF(
  left(
    regexp_replace(
      regexp_replace(lower("display_name"), '[^a-z0-9_]+', '_', 'g'),
      '^_+|_+$', '', 'g'
    ),
    32
  ),
  ''
)
WHERE "handle" IS NULL AND "display_name" IS NOT NULL;
--> statement-breakpoint

ALTER TABLE "profiles" DROP COLUMN "display_name";
