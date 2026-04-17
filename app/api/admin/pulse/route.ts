import { NextResponse } from 'next/server';
import { requireAdminWallet } from '@/lib/admin';
import {
  getAdminPulse,
  getDauWauMau,
  getDailyActiveSeries,
  getTodaysPuzzleHealth,
  getRevenueBreakdown,
  getRevenueSeries,
  getOpCosts,
} from '@/lib/db/queries';

/**
 * GET /api/admin/pulse
 *
 * Returns the full Pulse-tab dashboard payload: headline metric cards
 * (solves/active/premium/flagged), D/W/MAU with deltas, today's puzzle
 * health, revenue breakdown + 30-day series, op-cost ledger, and the
 * solves-per-day time series for the trend chart.
 *
 * **Response shape is intentionally nested** (`{ headline, activity,
 * dailySeries, todaysPuzzle, revenue, revenueSeries, opCostsMonthlyTotal }`),
 * not flat. Previous shape was the flat `AdminPulse` interface; the
 * only consumer is `components/admin/PulseTab.tsx` which ships in the
 * same commit. No external / public clients depend on this route.
 *
 * Admin-gated via `requireAdminWallet()` — non-admin callers get a 404
 * (not 403) so the route's existence isn't leaked.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const wallet = await requireAdminWallet();
  if (!wallet) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  // Run independent queries in parallel — each hits different tables
  // or different indexes so there's no meaningful contention.
  const [pulse, dauWauMau, dailySeries, todaysPuzzle, revenue, revenueSeries, costs] = await Promise.all([
    getAdminPulse(),
    getDauWauMau(),
    getDailyActiveSeries(30),
    getTodaysPuzzleHealth(),
    getRevenueBreakdown(30),
    getRevenueSeries(30),
    getOpCosts(),
  ]);

  const opCostsMonthlyTotal = costs.reduce((a, c) => a + c.monthlyUsd, 0);
  return NextResponse.json({
    headline: pulse,
    activity: dauWauMau,
    dailySeries,
    todaysPuzzle,
    revenue,
    revenueSeries,
    opCostsMonthlyTotal,
  });
}
