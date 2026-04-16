import { NextResponse } from 'next/server';
import { getWordmarksForWallet } from '@/lib/db/queries';

/**
 * GET /api/wordmarks/[wallet]
 *
 * Returns the wordmarks earned by a wallet, newest first. Used by
 * the Lexicon grid on the Stats panel to paint earned vs locked.
 *
 * Public endpoint — anyone can look up anyone's wordmarks. This
 * mirrors the leaderboard pattern (public data, wallet-keyed) and
 * supports future "share my Lexicon" surfaces without auth gymnastics.
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

  const entries = await getWordmarksForWallet(wallet);
  return NextResponse.json({
    wallet: wallet.toLowerCase(),
    entries: entries.map((e) => ({
      wordmarkId: e.wordmarkId,
      earnedAt: e.earnedAt.toISOString(),
      puzzleId: e.puzzleId,
    })),
  });
}
