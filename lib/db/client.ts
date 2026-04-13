import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

/**
 * Drizzle client wired to Neon’s HTTP driver.
 *
 * Uses the POOLED connection (`DATABASE_URL`) for runtime queries — Neon’s
 * pgbouncer pool gives us serverless-friendly connection reuse across cold
 * starts. Drizzle migrations use the *unpooled* connection via
 * `drizzle.config.ts`, because pgbouncer breaks DDL transactions.
 *
 * The `neon()` HTTP client is edge-runtime compatible, so this module can
 * be imported from either Node or Edge routes without changes.
 *
 * Call sites should import the singleton `db` — never construct a new
 * client per request.
 */

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  // Fail loudly and early — a missing DATABASE_URL in production will
  // produce confusing "undefined sql" errors deep in Drizzle otherwise.
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example → .env.local and fill in the Neon connection string.',
  );
}

const sql: NeonQueryFunction<false, false> = neon(DATABASE_URL);

export const db = drizzle(sql, { schema });

export { schema };
