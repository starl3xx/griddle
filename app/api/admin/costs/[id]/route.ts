import { NextResponse } from 'next/server';
import { requireAdminWallet } from '@/lib/admin';
import { deleteOpCost, upsertOpCost } from '@/lib/db/queries';

/**
 * PATCH  /api/admin/costs/[id]   body: { category?, label?, monthlyUsd?, notes? }
 * DELETE /api/admin/costs/[id]
 *
 * Field-level edit of a single op-cost row. Stamps updated_at /
 * updated_by for the audit trail. 404 to non-admins and to missing
 * rows.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PatchBody {
  category?: string;
  label?: string;
  monthlyUsd?: number;
  notes?: string | null;
}

function parseId(param: string): number | null {
  const n = parseInt(param, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const admin = await requireAdminWallet();
  if (!admin) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const { id: rawId } = await params;
  const id = parseId(rawId);
  if (id === null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  // PATCH requires all editable fields; upsertOpCost with an id is
  // a full update. Defaults from previous values are the caller's
  // responsibility — the client sends the full row.
  if (body.category === undefined || body.label === undefined || body.monthlyUsd === undefined) {
    return NextResponse.json({ error: 'category, label, monthlyUsd all required' }, { status: 400 });
  }
  // Trim first so the non-empty check catches whitespace-only input
  // (the InlineInput control sends `""` when a user clears a field
  // and blurs — without this guard that string reaches the DB and
  // persists a blank row in the ledger). Matches the POST route's
  // truthiness guard.
  const category = body.category.trim().slice(0, 32);
  const label = body.label.trim().slice(0, 80);
  const monthlyUsd = Number(body.monthlyUsd);
  if (!category || !label) {
    return NextResponse.json({ error: 'category and label must be non-empty' }, { status: 400 });
  }
  if (!Number.isFinite(monthlyUsd) || monthlyUsd < 0) {
    return NextResponse.json({ error: 'monthlyUsd must be non-negative' }, { status: 400 });
  }
  try {
    const row = await upsertOpCost({
      id,
      category,
      label,
      monthlyUsd,
      notes: body.notes ?? null,
      updatedBy: admin,
    });
    return NextResponse.json({ row });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('not found')) return NextResponse.json({ error: 'not found' }, { status: 404 });
    throw err;
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const admin = await requireAdminWallet();
  if (!admin) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const { id: rawId } = await params;
  const id = parseId(rawId);
  if (id === null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const ok = await deleteOpCost(id);
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
