import { NextResponse } from 'next/server';
import { getRecentAnomalies, updateSolveFlag } from '@/lib/db/queries';
import { requireAdminWallet } from '@/lib/admin';

/**
 * GET /api/admin/anomalies
 *
 * Returns the most recent flagged solves (suspicious + ineligible).
 * Wallet-allowlisted via the ADMIN_WALLETS env var. Caller must have
 * a connected wallet that's in the allowlist; otherwise 403.
 *
 * The session→wallet binding is established by /api/wallet/link when
 * the user connects, and lives in Upstash KV. So admin auth is:
 *   1. Cookie has a session_id (set by middleware)
 *   2. Session has a wallet bound (set after /api/wallet/link)
 *   3. Wallet is in ADMIN_WALLETS
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const adminWallet = await requireAdminWallet();
  if (!adminWallet) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const rows = await getRecentAnomalies(200);
  return NextResponse.json({ entries: rows });
}

/**
 * PATCH /api/admin/anomalies
 *
 * Body: `{ solveId: number, flag: 'ineligible' | 'suspicious' | null }`
 *
 * Admin moderation: change or clear the flag on a specific solve.
 * Passing `flag: null` marks the solve as legitimate (removes the flag
 * so it becomes eligible for the leaderboard).
 */
export async function PATCH(req: Request): Promise<NextResponse> {
  const adminWallet = await requireAdminWallet();
  if (!adminWallet) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let body: { solveId?: number; flag?: string | null };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  if (typeof body.solveId !== 'number' || !Number.isInteger(body.solveId)) {
    return NextResponse.json({ error: 'solveId must be an integer' }, { status: 400 });
  }

  const flag = body.flag === null ? null
    : body.flag === 'ineligible' ? 'ineligible'
    : body.flag === 'suspicious' ? 'suspicious'
    : undefined;

  if (flag === undefined) {
    return NextResponse.json(
      { error: 'flag must be "ineligible", "suspicious", or null' },
      { status: 400 },
    );
  }

  await updateSolveFlag(body.solveId, flag);
  return NextResponse.json({ ok: true });
}
