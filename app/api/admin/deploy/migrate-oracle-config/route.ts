import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { requireAdminWallet } from '@/lib/admin';

/**
 * POST /api/admin/deploy/migrate-oracle-config
 *
 * Applies the `oracle_config` table + row seed from migration 0022.
 * Idempotent — uses `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT
 * EXISTS`, and `INSERT … ON CONFLICT DO NOTHING` so re-running is a
 * no-op and deploy-time races don't double-seed.
 *
 * SQL is embedded rather than read from disk because:
 *   1. Bundler tracing of dynamic fs paths is finicky on Vercel (the
 *      sibling migrate-db route hits this with an invalid-config
 *      warning), and
 *   2. 0022 landed in a PR whose drizzle journal is already drifted
 *      from main; `bun run db:migrate` won't pick it up without
 *      manual journal surgery.
 *
 * Use via the "Apply DB migration" button in /admin → Oracle. Only
 * needed once per environment; safe to click multiple times.
 *
 * Requires DATABASE_URL_UNPOOLED (pgbouncer drops prepared statements
 * between queries and breaks transactional DDL).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MIGRATION_SQL = `
  CREATE TABLE IF NOT EXISTS "oracle_config" (
    "id" integer PRIMARY KEY NOT NULL,
    "pool_id" varchar(80) NOT NULL,
    "cron_enabled" boolean DEFAULT true NOT NULL,
    "oracle_address" varchar(42),
    "updated_at" timestamp DEFAULT now() NOT NULL,
    "updated_by" varchar(42)
  );
`;

// oracle_address column was added to the schema after the initial 0022
// shape, so handle both the "table never existed" and "table exists
// pre-column" cases.
const ADD_ORACLE_ADDRESS_SQL = `
  ALTER TABLE "oracle_config"
  ADD COLUMN IF NOT EXISTS "oracle_address" varchar(42);
`;

const SEED_SQL = `
  INSERT INTO "oracle_config" ("id", "pool_id", "cron_enabled")
  VALUES (1, '0xc5db937916d2c6f96142a6886ba8b5b74e14949c9cc1080a676ab2a5eb1ea275', true)
  ON CONFLICT ("id") DO NOTHING;
`;

export async function POST(): Promise<NextResponse> {
  const admin = await requireAdminWallet();
  if (!admin) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const url = process.env.DATABASE_URL_UNPOOLED;
  if (!url) {
    return NextResponse.json(
      { error: 'DATABASE_URL_UNPOOLED not configured' },
      { status: 503 },
    );
  }

  const runner = neon(url);
  try {
    // neon() returns a tagged-template function; raw SQL strings go
    // through .query(). Each statement runs independently (no
    // implicit BEGIN/COMMIT) which is fine because all three are
    // idempotent — re-running after a partial failure is safe.
    await runner.query(MIGRATION_SQL);
    await runner.query(ADD_ORACLE_ADDRESS_SQL);
    await runner.query(SEED_SQL);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `migration failed: ${msg}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, applied: '0022_oracle_config' });
}
