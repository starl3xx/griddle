import { NextResponse } from 'next/server';
import { requireAdminWallet } from '@/lib/admin';
import { grantPremium, getRecentPremiumGrants } from '@/lib/db/queries';
import { isValidAddress } from '@/lib/address';

/**
 * Admin-only premium grant endpoint.
 *
 *   POST /api/admin/grant-premium  body: { wallet?, handle?, reason? }
 *   GET  /api/admin/grant-premium  → recent grants (audit list)
 *
 * Both paths 404 on non-admin callers — no existence leak. Each grant
 * is recorded with the admin's wallet in `granted_by` for audit.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface GrantBody {
  wallet?: string;
  handle?: string;
  reason?: string;
}

export async function POST(req: Request): Promise<NextResponse> {
  const admin = await requireAdminWallet();
  if (!admin) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  let body: GrantBody;
  try {
    body = (await req.json()) as GrantBody;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const wallet = typeof body.wallet === 'string' ? body.wallet.trim() : null;
  const handle = typeof body.handle === 'string' ? body.handle.trim() : null;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : null;

  const hasWallet = wallet != null && wallet.length > 0;
  const hasHandle = handle != null && handle.length > 0;

  if (!hasWallet && !hasHandle) {
    return NextResponse.json(
      { error: 'wallet or handle required' },
      { status: 400 },
    );
  }
  if (hasWallet && hasHandle) {
    return NextResponse.json(
      { error: 'provide wallet OR handle, not both' },
      { status: 400 },
    );
  }
  if (hasWallet && !isValidAddress(wallet!)) {
    return NextResponse.json({ error: 'invalid wallet address' }, { status: 400 });
  }
  // Handles: client-enforced rules are deliberately loose — server rule
  // is length 1-32 after trim. The profiles unique index is case-
  // insensitive so "Alice" and "alice" collide at write time.
  if (hasHandle && (handle!.length < 1 || handle!.length > 32)) {
    return NextResponse.json(
      { error: 'handle must be 1–32 characters' },
      { status: 400 },
    );
  }

  try {
    const result = await grantPremium({
      wallet: hasWallet ? wallet : null,
      handle: hasHandle ? handle : null,
      grantedBy: admin,
      reason,
    });
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(): Promise<NextResponse> {
  const admin = await requireAdminWallet();
  if (!admin) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const grants = await getRecentPremiumGrants(50);
  return NextResponse.json({ grants });
}
