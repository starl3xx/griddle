import { NextResponse } from 'next/server';
import { getRecentAnomalies } from '@/lib/db/queries';
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
