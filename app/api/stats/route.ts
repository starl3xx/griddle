import { NextResponse } from 'next/server';
import { getSessionId } from '@/lib/session';
import { getSessionWallet } from '@/lib/wallet-session';
import { getWalletStats } from '@/lib/db/queries';

/**
 * GET /api/stats
 *
 * Returns aggregate stats for the wallet bound to the caller's session,
 * if any. Responds with `{ wallet: null }` when the session has no
 * connected wallet — the client renders that case as a Connect CTA
 * rather than an error. No public input, no PII, session-scoped.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const sessionId = await getSessionId();
  const wallet = await getSessionWallet(sessionId);

  if (!wallet) {
    return NextResponse.json({ wallet: null });
  }

  const stats = await getWalletStats(wallet);
  return NextResponse.json({ wallet, stats });
}
