import { NextResponse } from 'next/server';
import { requireAdminWallet } from '@/lib/admin';
import { getOpCosts, upsertOpCost } from '@/lib/db/queries';

/**
 * GET  /api/admin/costs        — list all op-cost rows
 * POST /api/admin/costs        — create a new row
 *
 * The Costs tab is the operator's editable monthly-expense ledger —
 * what the Pulse Revenue section subtracts to compute net margin.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PostBody {
  category?: string;
  label?: string;
  monthlyUsd?: number;
  notes?: string | null;
}

export async function GET(): Promise<NextResponse> {
  const admin = await requireAdminWallet();
  if (!admin) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const rows = await getOpCosts();
  const total = rows.reduce((a, r) => a + r.monthlyUsd, 0);
  return NextResponse.json({ rows, total });
}

export async function POST(req: Request): Promise<NextResponse> {
  const admin = await requireAdminWallet();
  if (!admin) return NextResponse.json({ error: 'not found' }, { status: 404 });

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const category = (body.category ?? '').trim().slice(0, 32);
  const label = (body.label ?? '').trim().slice(0, 80);
  const monthlyUsd = Number(body.monthlyUsd ?? 0);
  if (!category || !label || !Number.isFinite(monthlyUsd) || monthlyUsd < 0) {
    return NextResponse.json({ error: 'category, label, and non-negative monthlyUsd required' }, { status: 400 });
  }
  const row = await upsertOpCost({
    category,
    label,
    monthlyUsd,
    notes: body.notes ?? null,
    updatedBy: admin,
  });
  return NextResponse.json({ row });
}
