/**
 * Schema drift check — compares prod Neon against the tables + columns
 * declared in lib/db/schema.ts.
 *
 * Why this exists: migration 0014 (puzzle_crumbs) went unapplied on
 * prod for weeks because the GameClient fetch wraps its /api/crumbs
 * call in `.catch(() => {})` as a best-effort guard, silently
 * swallowing the 500 that the missing table produced. This script is
 * the drift canary — run it on a cron (or before any migration-
 * involving deploy) and a missing column / table will fail loudly
 * instead of degrading feature behavior silently.
 *
 * Run:  `bun run db:check`
 *
 * Requires DATABASE_URL_UNPOOLED in .env.local (or the environment).
 * Uses the unpooled URL because the pooled endpoint's pgbouncer drops
 * the `information_schema` prepared-statement metadata between calls.
 *
 * Exit codes:
 *   0 — all declared tables and columns exist in prod
 *   1 — at least one table or column is missing; details printed
 *
 * What this DOES NOT check (deliberate, for v1):
 *   - indexes / unique constraints
 *   - foreign keys
 *   - CHECK constraints
 *   - column types, nullability, defaults
 *   - extra tables / columns in prod that aren't in schema.ts
 *
 * Adding any of these belongs in a follow-up — the silent-failure
 * case 0014 exposed is fixed by "does the column exist at all" alone.
 */
import { Pool } from '@neondatabase/serverless';
import { config } from 'dotenv';
import { getTableColumns, getTableName, Table } from 'drizzle-orm';
import * as schema from '../lib/db/schema';

config({ path: '.env.local' });

const url = process.env.DATABASE_URL_UNPOOLED;
if (!url) {
  console.error('DATABASE_URL_UNPOOLED not set. Copy .env.example → .env.local.');
  process.exit(1);
}

const pool = new Pool({ connectionString: url });

interface ExpectedTable {
  tableName: string;
  columns: string[];
}

function collectExpected(): ExpectedTable[] {
  const tables: ExpectedTable[] = [];
  for (const value of Object.values(schema)) {
    // Drizzle tables carry an internal symbol; getTableName throws on
    // anything else. A try/catch is the documented way to duck-type
    // here — safer than reaching into `_.type`, which has moved
    // between drizzle major versions.
    let tableName: string;
    try {
      tableName = getTableName(value as Table);
    } catch {
      continue;
    }
    const cols = getTableColumns(value as Table);
    const columnNames = Object.values(cols).map((c) => c.name);
    tables.push({ tableName, columns: columnNames });
  }
  tables.sort((a, b) => a.tableName.localeCompare(b.tableName));
  return tables;
}

async function main(): Promise<void> {
  const expected = collectExpected();

  // Single pass each for tables + columns — cheaper than probing per
  // expected entry and keeps the script's load on prod below one second.
  const tablesRes = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
  );
  const actualTables = new Set(tablesRes.rows.map((r) => r.table_name));

  const columnsRes = await pool.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`,
  );
  const actualColumns: Record<string, Set<string>> = {};
  for (const r of columnsRes.rows) {
    (actualColumns[r.table_name] ??= new Set()).add(r.column_name);
  }

  const missing: string[] = [];
  for (const { tableName, columns } of expected) {
    if (!actualTables.has(tableName)) {
      missing.push(`table "${tableName}" missing`);
      continue;
    }
    const cols = actualColumns[tableName] ?? new Set();
    for (const col of columns) {
      if (!cols.has(col)) missing.push(`column "${tableName}"."${col}" missing`);
    }
  }

  const totalExpectedColumns = expected.reduce((n, t) => n + t.columns.length, 0);
  console.log(
    `Schema check: ${expected.length} tables, ${totalExpectedColumns} columns expected from lib/db/schema.ts\n`,
  );

  if (missing.length === 0) {
    console.log('✓ All declared tables and columns present in prod.');
    await pool.end();
    process.exit(0);
  }

  console.error(`✗ ${missing.length} drift issue${missing.length === 1 ? '' : 's'} found:\n`);
  for (const m of missing) console.error(`  - ${m}`);
  console.error(
    '\nMost likely cause: a migration SQL file was committed but never applied to prod Neon. Apply via `bun run db:migrate` or directly.',
  );
  await pool.end();
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  pool.end();
  process.exit(1);
});
