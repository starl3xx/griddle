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

INSERT INTO "admin_costs" ("category", "label", "monthly_usd") VALUES
  ('infra', 'Vercel Pro',     0),
  ('infra', 'Neon Postgres',  0),
  ('infra', 'Upstash Redis',  0),
  ('email', 'Resend',         0),
  ('infra', 'Domain + DNS',   0)
ON CONFLICT DO NOTHING;
