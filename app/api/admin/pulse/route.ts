import { NextResponse } from 'next/server';
import { requireAdminWallet } from '@/lib/admin';
import { getAdminPulse } from '@/lib/db/queries';

/**
 * GET /api/admin/pulse
 *
 * Returns the headline numbers for the admin dashboard's Pulse tab.
 * Admin-gated via the same wallet-session binding as `/admin` — non-admin
 * callers get a 404 (not 403) so the route's existence isn't leaked.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const wallet = await requireAdminWallet();
  if (!wallet) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const pulse = await getAdminPulse();
  return NextResponse.json(pulse);
}
