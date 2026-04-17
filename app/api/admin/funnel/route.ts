import { NextResponse } from 'next/server';
import { requireAdminWallet } from '@/lib/admin';
import {
  getFunnelStats,
  getFunnelDropOff,
  getFunnelEntryPoints,
  getFunnelTimeToStage,
  type FunnelWindow,
} from '@/lib/db/queries';

/**
 * GET /api/admin/funnel?window=7d
 *
 * Returns the full Funnel-tab payload: original stage counts +
 * breakdown + time-to-convert, PLUS drop-off rates, entry-point
 * breakdown, and stage-to-stage medians.
 *
 * **Response shape is intentionally nested** (`{ stats, dropOff,
 * entryPoints, timeToStage }`). Previous shape was `FunnelStats`
 * flat at the top level; the only consumer is
 * `components/admin/FunnelTab.tsx`, which is updated in the same
 * commit. No external / public clients depend on this route.
 *
 * Admin-gated — 404 to non-admin callers so the route's existence
 * isn't leaked.
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

  const [stats, dropOff, entryPoints, timeToStage] = await Promise.all([
    getFunnelStats(window),
    getFunnelDropOff(window),
    getFunnelEntryPoints(window),
    getFunnelTimeToStage(window),
  ]);
  return NextResponse.json({ stats, dropOff, entryPoints, timeToStage });
}
