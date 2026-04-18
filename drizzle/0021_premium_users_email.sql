-- M6-premium-email-anchor: email snapshot on premium_users.
--
-- Email becomes the durable identity anchor across wallets, magic-link
-- signups, and customer support. Stripe collects email on every
-- checkout; the crypto unlock form asks for it optionally alongside the
-- now-required handle. The column is nullable (pre-change rows have no
-- email and admin_grant rows legitimately may not) and not unique
-- (two wallets can share an email — e.g. a user unlocking premium on a
-- second wallet).
--
-- Indexed on lower(email) so the admin Transactions tab can search
-- case-insensitively without a seq scan.

ALTER TABLE "premium_users"
  ADD COLUMN IF NOT EXISTS "email" varchar(254);

CREATE INDEX IF NOT EXISTS "premium_users_email_lower_idx"
  ON "premium_users" (lower("email"))
  WHERE "email" IS NOT NULL;
