import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { profiles } from '@/lib/db/schema';
import { getWordmarksForPlayer } from '@/lib/db/queries';

/**
 * GET /api/wordmarks/[wallet]
 *
 * Returns the wordmarks earned under a given wallet address, newest
 * first. Public endpoint — anyone can look up anyone's wordmarks by
 * their wallet. Mirrors the leaderboard pattern and supports future
 * "share my Lexicon" URLs without auth gymnastics.
 *
 * Implementation note: wordmarks are keyed on the generated
 * `player_key` column, which after PR #64's backfill is `p:<id>` for
 * any wallet that maps to a profile. A naive `{ wallet }` identity
 * lookup would miss every profiled wallet's rows, so we first resolve
 * the wallet to its profile (if any) and pass the full identity
 * through. Wallets without a profile fall through to the raw-wallet
 * player_key.
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

  const walletLower = wallet.toLowerCase();

  // Look up the profile (if any) for this wallet so the player_key
  // query lands on `p:<id>` when one exists, not the raw address.
  const [profile] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.wallet, walletLower))
    .limit(1);

  const entries = await getWordmarksForPlayer({
    profileId: profile?.id ?? null,
    wallet: walletLower,
  });
  return NextResponse.json({
    wallet: walletLower,
    entries: entries.map((e) => ({
      wordmarkId: e.wordmarkId,
      earnedAt: e.earnedAt.toISOString(),
      puzzleId: e.puzzleId,
    })),
  });
}
