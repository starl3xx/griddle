import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
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

  // TEMPORARY DIAGNOSTIC: admin-grant drift investigation. Remove
  // once the root cause of /api/premium/[wallet] returning premium:false
  // for a wallet that has a verified row in premium_users is understood.
  console.log('[premium/wallet/debug]', JSON.stringify({
    rawWalletParam: wallet,
    normalized,
    rowCount: rows.length,
    firstRow: rows[0] ?? null,
    dbHostHint: (process.env.DATABASE_URL ?? '').match(/@([^/]+)/)?.[1]?.slice(0, 32) ?? 'no-match',
    buildTime: new Date().toISOString(),
  }));

  return NextResponse.json({ wallet: normalized, premium: rows.length > 0 });
}
