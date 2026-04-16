import { NextResponse } from 'next/server';
import { getWordmarksForPlayer } from '@/lib/db/queries';

/**
 * GET /api/wordmarks/[wallet]
 *
 * Returns the wordmarks earned under a given wallet address, newest
 * first. Public endpoint — anyone can look up anyone's wordmarks by
 * their wallet. This mirrors the leaderboard pattern and supports
 * future "share my Lexicon" URLs without auth gymnastics.
 *
 * Wallet-only lookup; handle-only users aren't reachable by this
 * route (there's no wallet to reference them). Client-side Lexicon
 * rendering for the signed-in user goes through `/api/wordmarks/me`
 * which resolves the session's profile identity server-side.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ wallet: string }> },
): Promise<NextResponse> {
  const { wallet } = await params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    return NextResponse.json({ error: 'invalid wallet' }, { status: 400 });
  }

  const entries = await getWordmarksForPlayer({ wallet });
  return NextResponse.json({
    wallet: wallet.toLowerCase(),
    entries: entries.map((e) => ({
      wordmarkId: e.wordmarkId,
      earnedAt: e.earnedAt.toISOString(),
      puzzleId: e.puzzleId,
    })),
  });
}
