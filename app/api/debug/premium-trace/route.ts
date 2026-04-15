import { NextResponse } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { premiumUsers } from '@/lib/db/schema';
import { requireAdminWallet } from '@/lib/admin';

/**
 * GET /api/debug/premium-trace?wallet=0x...
 *
 * Admin-only diagnostic for "grant exists but /api/premium/[wallet]
 * returns premium:false" drift. Runs the exact queries the live
 * endpoints run and returns a structured trace of what the DB sees.
 *
 * Specifically, for the given wallet we report:
 *   - `eqLookup`       — `eq(premiumUsers.wallet, normalized)` — the
 *                        same drizzle call the real premium route uses
 *   - `lowerEqLookup`  — case-insensitive via lower() for comparison
 *   - `adminGrantRows` — all rows with source='admin_grant' so we can
 *                        compare exact byte length + hex encoding
 *   - `totalCount`     — how many rows exist at all
 *   - `dbHostHint`     — first 12 chars of the Neon host so we can
 *                        confirm which database Vercel is actually on
 *                        (full URL would leak the password)
 *
 * 404s for non-admin callers so the route's existence isn't leaked.
 * Safe to leave deployed while we debug; can be removed once the
 * drift is understood.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse> {
  const admin = await requireAdminWallet();
  if (!admin) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const walletParam = searchParams.get('wallet') ?? '';
  const normalized = walletParam.toLowerCase().trim();

  // The exact drizzle call /api/premium/[wallet] makes.
  const eqLookup = await db
    .select({ wallet: premiumUsers.wallet })
    .from(premiumUsers)
    .where(eq(premiumUsers.wallet, normalized))
    .limit(5);

  // Case-insensitive variant via raw lower() — if this finds rows
  // the eq lookup doesn't, we have a casing drift somewhere.
  const lowerEqLookup = await db.execute<{ wallet: string; hex: string; len: number }>(sql`
    SELECT wallet,
           encode(wallet::bytea, 'hex') AS hex,
           length(wallet) AS len
    FROM premium_users
    WHERE lower(wallet) = lower(${normalized})
    LIMIT 5
  `);

  // All admin_grant rows, with their exact byte shape for comparison.
  const adminGrantRows = await db.execute<{ wallet: string; hex: string; len: number; source: string }>(sql`
    SELECT wallet,
           encode(wallet::bytea, 'hex') AS hex,
           length(wallet) AS len,
           source
    FROM premium_users
    WHERE source = 'admin_grant'
    LIMIT 10
  `);

  const totalCount = await db.execute<{ count: number }>(sql`
    SELECT count(*)::int AS count FROM premium_users
  `);

  // Partial Neon host. DATABASE_URL looks like
  // postgres://user:pass@HOST/db?sslmode=require — we extract HOST
  // and return only the first 20 chars so a log dump can't leak the
  // password portion.
  const raw = process.env.DATABASE_URL ?? '';
  const hostMatch = raw.match(/@([^/]+)/);
  const dbHostHint = hostMatch ? hostMatch[1].slice(0, 32) : 'no-match';

  // Normalize db.execute return shape (array vs {rows}) so the
  // response is always a flat JSON object.
  const asRows = <T>(r: unknown): T[] =>
    Array.isArray(r) ? (r as T[]) : ((r as { rows?: T[] }).rows ?? []);

  const payload = {
    input: {
      walletParam,
      normalized,
      normalizedLength: normalized.length,
    },
    eqLookup: {
      count: eqLookup.length,
      rows: eqLookup,
    },
    lowerEqLookup: {
      count: asRows<{ wallet: string; hex: string; len: number }>(lowerEqLookup).length,
      rows: asRows(lowerEqLookup),
    },
    adminGrantRows: {
      count: asRows<{ wallet: string; hex: string; len: number; source: string }>(adminGrantRows).length,
      rows: asRows(adminGrantRows),
    },
    totalCount: asRows<{ count: number }>(totalCount)[0]?.count ?? 0,
    dbHostHint,
  };

  // Log so the whole trace also appears in Vercel runtime logs —
  // easier to dig out via the MCP tooling than the response body.
  console.log('[debug/premium-trace]', JSON.stringify(payload));

  return NextResponse.json(payload);
}
