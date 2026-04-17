-- Admin op-cost ledger: the Costs tab in /admin writes here. Pulse's
-- Revenue section reads this to compute net margin (gross - op costs).
--
-- One row per recurring expense (Resend, Vercel, Neon, Upstash, Stripe
-- base fees, etc.). monthly_usd is the flat monthly spend; Pulse
-- prorates by days-elapsed-in-month when computing MTD net.
--
-- Seed with zero-dollar placeholders for the common services so the
-- operator has a starting list to fill in via the UI.

CREATE TABLE IF NOT EXISTS "admin_costs" (
  "id"           serial        PRIMARY KEY,
  "category"     varchar(32)   NOT NULL,
  "label"        varchar(80)   NOT NULL,
  "monthly_usd"  numeric(10,2) NOT NULL DEFAULT 0,
  "notes"        varchar(200),
  "updated_at"   timestamp     NOT NULL DEFAULT now(),
  "updated_by"   varchar(42)
);

-- Idempotent seed: the table has no UNIQUE on (category, label)
-- (id is a serial), so an `ON CONFLICT DO NOTHING` would never
-- actually skip a duplicate row — it'd silently insert duplicates
-- on a re-run. Use NOT EXISTS instead so a second invocation is a
-- no-op regardless of whether unique constraints exist.
INSERT INTO "admin_costs" ("category", "label", "monthly_usd")
SELECT v.category, v.label, v.monthly_usd
FROM (VALUES
  ('infra', 'Vercel Pro',     0::numeric),
  ('infra', 'Neon Postgres',  0::numeric),
  ('infra', 'Upstash Redis',  0::numeric),
  ('email', 'Resend',         0::numeric),
  ('infra', 'Domain + DNS',   0::numeric)
) AS v(category, label, monthly_usd)
WHERE NOT EXISTS (
  SELECT 1 FROM "admin_costs" ac
  WHERE ac.category = v.category AND ac.label = v.label
);
