import type { Config } from 'drizzle-kit';
import { config } from 'dotenv';

// Load .env.local for CLI commands (drizzle-kit doesn’t auto-load it).
config({ path: '.env.local' });

export default {
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    // Migrations MUST use the unpooled connection — pgbouncer drops
    // prepared statements between queries, which breaks Drizzle’s
    // transactional DDL.
    url: process.env.DATABASE_URL_UNPOOLED ?? '',
  },
  strict: true,
  verbose: true,
} satisfies Config;
