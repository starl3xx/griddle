import { NextResponse } from 'next/server';
import { getSessionId } from '@/lib/session';
import { getSessionWallet } from '@/lib/wallet-session';
import { getSessionProfile } from '@/lib/session-profile';
import { insertWordmarksIfNew, solveBelongsTo } from '@/lib/db/queries';
import { db } from '@/lib/db/client';
import { solves } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';

/**
 * POST /api/wordmarks/megaphone
 *
 * Client-side award path for the Megaphone wordmark. Fired from
 * SolveModal's share handler only after a share action has actually
 * been confirmed (composeCast returned 'cast', navigator.share
 * resolved, or clipboard writeText resolved). Cancels + errors do
 * NOT call this endpoint.
 *
 * Requires SOME identity bound to the session — wallet or profile.
 * Anonymous session-only users can still share but can't durably
 * earn Megaphone (no place to pin the badge). No premium gate:
 * sharing is a free action regardless of upgrade state.
 *
 * Idempotent via the `(player_key, wordmark_id)` unique index on the
 * wordmarks table (player_key is profile_id-preferred, wallet
 * fallback) so a user spamming the share button doesn't create extra
 * rows or inflate the earn count. The response distinguishes "earned
 * just now" from "already earned previously" via the `firstTime`
 * boolean so the client can conditionally show the earn toast.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  const sessionId = await getSessionId();
  const [wallet, profileId] = await Promise.all([
    getSessionWallet(sessionId),
    getSessionProfile(sessionId),
  ]);
  if (!wallet && profileId == null) {
    return NextResponse.json(
      { error: 'identity required to earn wordmarks' },
      { status: 401 },
    );
  }

  const identity = { profileId, wallet, sessionId };

  // Guard: the user must have at least one successful solve to earn
  // Megaphone. Without this, a direct POST (curl) could mint the badge
  // without ever solving or sharing. Deliberately does NOT exclude
  // flagged solves — a user whose solve was flagged still saw the
  // SolveModal, could share, and the share succeeded. Excluding them
  // would return 403 after a real share action.
  const hasSolve = await db
    .select({ id: solves.id })
    .from(solves)
    .where(and(solveBelongsTo(identity), eq(solves.solved, true)))
    .limit(1);
  if (hasSolve.length === 0) {
    return NextResponse.json(
      { error: 'solve a puzzle before earning Megaphone' },
      { status: 403 },
    );
  }

  const inserted = await insertWordmarksIfNew(identity, ['megaphone'], null);
  return NextResponse.json({
    wordmarkId: 'megaphone',
    firstTime: inserted.length > 0,
  });
}
