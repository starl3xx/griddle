import { NextResponse } from 'next/server';
import { getSessionId } from '@/lib/session';
import {
  getPreviousSolveMsForPuzzle,
  getPuzzleByDay,
  getPuzzleStartedAt,
  recordPuzzleLoad,
} from '@/lib/db/queries';
import { resolveSessionIdentity } from '@/lib/session-identity';
import { getCurrentDayNumber } from '@/lib/scheduler';

/**
 * GET /api/puzzle/[day]
 *
 * Returns the puzzle for a specific day number. Used by the archive
 * panel to load past puzzles into the main game grid. The target word
 * is never included — same security boundary as /api/puzzle/today.
 *
 * Records a puzzle_load so serverSolveMs can be computed if the user
 * solves the archive puzzle (though archive solves don't qualify for
 * the leaderboard).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ day: string }> },
): Promise<NextResponse> {
  const { day } = await params;
  const dayNumber = parseInt(day, 10);
  if (!Number.isInteger(dayNumber) || dayNumber < 1) {
    return NextResponse.json({ error: 'invalid day number' }, { status: 400 });
  }

  // Prevent fetching future puzzles — the grid contains all 9 letters
  // of the target word, so leaking it early would let solvers pre-compute
  // the answer via an anagram solver.
  if (dayNumber > getCurrentDayNumber()) {
    return NextResponse.json({ error: 'that puzzle is not available yet' }, { status: 403 });
  }

  const sessionId = await getSessionId();
  const puzzle = await getPuzzleByDay(dayNumber);
  if (!puzzle) {
    return NextResponse.json({ error: 'no puzzle for that day' }, { status: 404 });
  }

  await recordPuzzleLoad(sessionId, puzzle.id);

  // started_at + prior-solve detection in parallel, for the same
  // reason app/page.tsx does: so navigating to an archive puzzle the
  // player has previously started (or solved) hydrates the post-
  // solve UI state (frozen timer, crumb lock) without flashing a
  // wrongly-ticking timer or re-arming crumb discovery.
  const [startedAt, { wallet: sessionWallet, profileId }] = await Promise.all([
    getPuzzleStartedAt(sessionId, puzzle.dayNumber),
    resolveSessionIdentity(sessionId),
  ]);
  const previousSolveMs = await getPreviousSolveMsForPuzzle(
    { sessionId, wallet: sessionWallet, profileId },
    puzzle.id,
  );

  return NextResponse.json({
    dayNumber: puzzle.dayNumber,
    date: puzzle.date,
    grid: puzzle.grid,
    startedAt: startedAt != null ? startedAt.toISOString() : null,
    previousSolveMs,
  });
}
