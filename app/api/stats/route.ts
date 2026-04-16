import { NextResponse } from 'next/server';
import { getSessionId } from '@/lib/session';
import { getSessionWallet } from '@/lib/wallet-session';
import { getSessionProfile } from '@/lib/session-profile';
import { getWalletStats } from '@/lib/db/queries';

/**
 * GET /api/stats
 *
 * Returns aggregate stats for the player bound to the caller's session,
 * where "player" is resolved by profile id, wallet, or (as a fallback
 * for pre-backfill rows) the session id itself. Handle-only users —
 * who may never bind a wallet — are now first-class here; the earlier
 * wallet-only version returned `{ wallet: null }` for them, leaving
 * the Stats modal blank even after solves.
 *
 * Returns `{ wallet: null, stats: null }` when the caller is fully
 * anonymous (no profile, no wallet). The client renders that case as
 * a Create-profile CTA rather than an error.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const sessionId = await getSessionId();
  const [wallet, profileId] = await Promise.all([
    getSessionWallet(sessionId),
    getSessionProfile(sessionId),
  ]);

  if (!wallet && profileId == null) {
    return NextResponse.json({ wallet: null, stats: null });
  }

  const stats = await getWalletStats({ profileId, wallet, sessionId });
  return NextResponse.json({ wallet, stats });
}
