import { Redis } from '@upstash/redis';

/**
 * Upstash Redis singleton.
 *
 * Used as the read-through cache layer in front of Neon (`lib/db/queries.ts`)
 * so today’s puzzle row doesn’t need to be re-queried on every page load
 * or solve submission. Edge-runtime safe — the `@upstash/redis` client uses
 * HTTPS, not TCP/WebSocket, so it works in both Node and Edge contexts.
 *
 * The `KV_*` env names are a Vercel/Upstash convention left over from
 * Vercel KV branding. Both names point at the same Upstash database.
 *
 * Throws loudly at import time if creds are missing — same fail-fast
 * pattern as `lib/db/client.ts`. A missing env var should surface at
 * server startup, not deep inside a query path.
 */

const url = process.env.KV_REST_API_URL;
const token = process.env.KV_REST_API_TOKEN;

if (!url || !token) {
  throw new Error(
    'KV_REST_API_URL and KV_REST_API_TOKEN must be set. Copy .env.example → .env.local and fill in the Upstash connection details.',
  );
}

export const kv = new Redis({ url, token });
