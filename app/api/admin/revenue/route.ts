import { NextResponse } from 'next/server';
import { requireAdminWallet } from '@/lib/admin';
import {
  getRevenueBreakdown,
  getRevenueSeries,
  getOpCosts,
} from '@/lib/db/queries';

/**
 * GET /api/admin/revenue?window=30
 *
 * Revenue dashboard payload. Returns source breakdown (crypto / fiat-
 * burned / fiat-pending / fiat-refunded / admin grants) plus the
 * daily time series for the stacked-bar chart, plus op-cost totals
 * for the net-margin math.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse> {
  const admin = await requireAdminWallet();
  if (!admin) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const rawWindow = parseInt(searchParams.get('window') ?? '30', 10);
  const windowDays = Number.isFinite(rawWindow) ? Math.min(365, Math.max(1, rawWindow)) : 30;

  const [breakdown, series, costs, allTime] = await Promise.all([
    getRevenueBreakdown(windowDays),
    getRevenueSeries(windowDays),
    getOpCosts(),
    getRevenueBreakdown(),
  ]);

  const opCostsMonthlyTotal = costs.reduce((a, c) => a + c.monthlyUsd, 0);
  return NextResponse.json({ window: windowDays, breakdown, series, costs, opCostsMonthlyTotal, allTime });
}
