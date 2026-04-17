import { NextResponse } from 'next/server';
import { requireAdminWallet } from '@/lib/admin';
import { getRetentionCohorts } from '@/lib/db/queries';

/**
 * GET /api/admin/retention?weeks=12
 *
 * Weekly cohort retention matrix. Returns cohort size + W1/W2/W4/W8
 * return rates per cohort, newest first. Header summary (D1/D7/D30
 * averages) is computed on the client from this payload.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse> {
  const admin = await requireAdminWallet();
  if (!admin) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const rawWeeks = parseInt(searchParams.get('weeks') ?? '12', 10);
  const weeks = Number.isFinite(rawWeeks) ? Math.min(26, Math.max(4, rawWeeks)) : 12;

  const cohorts = await getRetentionCohorts(weeks);
  return NextResponse.json({ cohorts });
}
