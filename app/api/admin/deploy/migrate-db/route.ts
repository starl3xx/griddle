import { NextResponse } from 'next/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { neon } from '@neondatabase/serverless';
import { requireAdminWallet } from '@/lib/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/admin/deploy/migrate-db
 *
 * Runs the `drizzle/0019_premium_payment_telemetry.sql` migration on
 * the prod Neon DB. Idempotent — uses ADD COLUMN IF NOT EXISTS and
 * CREATE UNIQUE INDEX IF NOT EXISTS throughout, so re-running is a
 * no-op.
 *
 * Requires DATABASE_URL_UNPOOLED in server env (the direct connection
 * URL; pgbouncer drops prepared statements between queries and breaks
 * Drizzle's transactional DDL, so migrations must skip the pooler).
 */
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

  // Resolve migration file against process cwd (Next.js runs from
  // project root).
  const migrationPath = join(process.cwd(), 'drizzle', '0019_premium_payment_telemetry.sql');
  let sql: string;
  try {
    sql = readFileSync(migrationPath, 'utf8');
  } catch (err) {
    return NextResponse.json(
      { error: `could not read ${migrationPath}: ${(err as Error).message}` },
      { status: 500 },
    );
  }

  const runner = neon(url);

  try {
    // Neon HTTP runs statements one at a time via `.query()`. Strip
    // line comments FIRST (otherwise a leading block of `--` lines
    // attached to the ALTER TABLE chunk would make that chunk start
    // with `--`, and a naive chunk-level comment filter would drop
    // the migration's main statement — which is what shipped in the
    // first version of this endpoint until Bugbot caught it). With
    // comments stripped, splitting on semicolons gives just the DDL.
    const cleaned = sql.replace(/--[^\n]*/g, '').trim();
    const statements = cleaned
      .split(/;\s*/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      await runner.query(stmt);
    }

    // Sanity read: confirm the new columns exist.
    const rows = (await runner.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'premium_users'
         AND column_name IN ('usdc_amount','word_burned','escrow_status','escrow_open_tx','escrow_burn_tx','external_id')`,
    )) as Array<{ column_name: string }>;

    return NextResponse.json({
      ok: true,
      statementsApplied: statements.length,
      columnsPresent: rows.map((r) => r.column_name),
    });
  } catch (err) {
    return NextResponse.json(
      { error: `migration failed: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
