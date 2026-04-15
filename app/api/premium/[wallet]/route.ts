import { NextResponse } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { premiumUsers } from '@/lib/db/schema';
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

  const rows = await db
    .select({ wallet: premiumUsers.wallet })
    .from(premiumUsers)
    .where(eq(premiumUsers.wallet, normalized))
    .limit(1);

  // DEEPER DIAGNOSTIC: run the same lookup four more ways to pin down
  // where the drift is. Compare against the /api/debug/premium-trace
  // route which ran the same eq() query and found 1 row. If any of
  // these diverge from each other we'll see exactly which layer is
  // lying.
  let rawEqCount = -1;
  let rawLowerCount = -1;
  let totalCount = -1;
  let firstFive: unknown[] = [];
  let debugErr: string | null = null;
  try {
    const rawEq = await db.execute<{ wallet: string }>(sql`
      SELECT wallet FROM premium_users WHERE wallet = ${normalized} LIMIT 1
    `);
    rawEqCount = Array.isArray(rawEq) ? rawEq.length : (rawEq.rows?.length ?? -2);

    const rawLower = await db.execute<{ wallet: string }>(sql`
      SELECT wallet FROM premium_users WHERE lower(wallet) = lower(${normalized}) LIMIT 1
    `);
    rawLowerCount = Array.isArray(rawLower) ? rawLower.length : (rawLower.rows?.length ?? -2);

    const all = await db.execute<{ wallet: string; source: string }>(sql`
      SELECT wallet, source FROM premium_users LIMIT 5
    `);
    const allRows = Array.isArray(all) ? all : (all.rows ?? []);
    firstFive = allRows;

    const total = await db.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count FROM premium_users
    `);
    const totalRows = Array.isArray(total) ? total : (total.rows ?? []);
    totalCount = totalRows[0]?.count ?? -3;
  } catch (e) {
    debugErr = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }

  console.log('[premium/wallet/debug]', JSON.stringify({
    rawWalletParam: wallet,
    normalized,
    normalizedLength: normalized.length,
    drizzleEqRowCount: rows.length,
    drizzleEqFirstRow: rows[0] ?? null,
    rawEqCount,
    rawLowerCount,
    totalCount,
    firstFive,
    debugErr,
    dbHostHint: (process.env.DATABASE_URL ?? '').match(/@([^/]+)/)?.[1]?.slice(0, 32) ?? 'no-match',
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV,
    vercelUrl: process.env.VERCEL_URL?.slice(0, 40),
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID?.slice(0, 20),
    buildTime: new Date().toISOString(),
  }));

  return NextResponse.json({ wallet: normalized, premium: rows.length > 0 });
}
