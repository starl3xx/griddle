import { NextResponse } from 'next/server';
import { requireAdminWallet } from '@/lib/admin';
import { getFunnelStats, type FunnelWindow } from '@/lib/db/queries';

/**
 * GET /api/admin/funnel?window=7d
 *
 * Returns stage counts + breakdown + time-to-convert medians for the
 * admin Funnel tab. Admin-gated via the same wallet-session check as
 * the rest of /api/admin/*; non-admin callers see a 404 so the route's
 * existence isn't leaked.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_WINDOWS: FunnelWindow[] = ['24h', '7d', '30d', 'all'];

export async function GET(req: Request): Promise<NextResponse> {
  const admin = await requireAdminWallet();
  if (!admin) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const url = new URL(req.url);
  const raw = url.searchParams.get('window') ?? '7d';
  const window: FunnelWindow = VALID_WINDOWS.includes(raw as FunnelWindow)
    ? (raw as FunnelWindow)
    : '7d';

  const stats = await getFunnelStats(window);
  return NextResponse.json(stats);
}
