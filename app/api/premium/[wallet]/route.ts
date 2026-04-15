import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { isValidAddress } from '@/lib/address';

/**
 * GET /api/premium/[wallet]
 *
 * Returns `{premium: boolean}` for the given wallet address. Used by
 * the client immediately after a wallet connects to decide whether to
 * show premium features (archive, stats, unassisted toggle).
 *
 * Premium status is server-side (DB) — the M5 contract burn is the
 * deflationary signal, not the access-control mechanism. The DB row
 * is the single source of truth across both the crypto path
 * (GriddlePremium.unlockWithPermit observed by an event listener)
 * and the future Apple Pay path (Stripe webhook).
 *
 * Implementation note: uses raw SQL via `db.execute()` instead of the
 * drizzle query builder's `eq(premiumUsers.wallet, ...)`. An in-prod
 * investigation (see commit history around 2026-04-15) turned up a
 * reproducible drift where the same `eq()` call from this file's
 * handler returned 0 rows while (a) the row demonstrably existed in
 * `premium_users` via direct SQL, (b) a sibling `/api/debug/premium-
 * trace` route ran the identical drizzle builder and found the row,
 * and (c) a raw SQL `SELECT … WHERE wallet = $1` from THIS handler
 * also found the row. Root cause unknown (possibly a route-specific
 * bundling quirk with the drizzle column reference; no reproducer
 * extracted yet). Raw SQL is the proven-correct path, so we use it
 * until the drizzle side is understood — the fallback is cheap and
 * has no observable semantic difference.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ wallet: string }> },
): Promise<NextResponse> {
  const { wallet } = await params;

  if (!isValidAddress(wallet)) {
    return NextResponse.json({ error: 'invalid wallet address' }, { status: 400 });
  }

  const normalized = wallet.toLowerCase();

  const result = await db.execute<{ wallet: string }>(sql`
    SELECT wallet FROM premium_users WHERE wallet = ${normalized} LIMIT 1
  `);
  const rows = Array.isArray(result) ? result : (result.rows ?? []);

  return NextResponse.json({ wallet: normalized, premium: rows.length > 0 });
}
