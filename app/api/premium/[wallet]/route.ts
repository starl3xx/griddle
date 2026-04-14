import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { premiumUsers } from '@/lib/db/schema';

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

  return NextResponse.json({ wallet: normalized, premium: rows.length > 0 });
}

function isValidAddress(s: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(s);
}
