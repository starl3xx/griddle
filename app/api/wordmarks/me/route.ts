import { NextResponse } from 'next/server';
import { getSessionId } from '@/lib/session';
import { resolveSessionIdentity } from '@/lib/session-identity';
import { getWordmarksForPlayer } from '@/lib/db/queries';

/**
 * GET /api/wordmarks/me
 *
 * Returns the wordmarks earned by the caller, resolving their
 * identity server-side from the session (profile + wallet bindings).
 * Used by the Lexicon grid on the Stats panel so handle-only and
 * email-auth users — who have no wallet to stick in the URL — still
 * see their own earned wordmarks light up.
 *
 * Returns `{ entries: [] }` for anonymous callers rather than a 401,
 * so the grid can render cleanly (everything locked) without the
 * client branching on status codes.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const sessionId = await getSessionId();
  const { wallet, profileId } = await resolveSessionIdentity(sessionId);

  const entries = await getWordmarksForPlayer({ profileId, wallet });
  return NextResponse.json({
    entries: entries.map((e) => ({
      wordmarkId: e.wordmarkId,
      earnedAt: e.earnedAt.toISOString(),
      puzzleId: e.puzzleId,
    })),
  });
}
