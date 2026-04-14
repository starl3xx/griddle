import { NextResponse } from 'next/server';
import { getSessionId } from '@/lib/session';
import { getTodayPuzzle, recordPuzzleLoad } from '@/lib/db/queries';

/**
 * GET /api/puzzle/today
 *
 * Returns today’s puzzle (grid + day number + date). The **target word
 * is never included in the response.** Solve verification happens on
 * POST /api/solve by comparing the client’s claim against the server-
 * stored word — the client never sees the answer.
 *
 * Side effects:
 *   - Upserts a `puzzle_loads` row recording the first time this session
 *     saw this puzzle (idempotent via ON CONFLICT DO NOTHING). The row
 *     is the authoritative start time for `server_solve_ms`.
 *
 * Session cookie handling is owned by `middleware.ts`, which has already
 * run by the time this handler executes — so the session id is
 * guaranteed to be present.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const sessionId = await getSessionId();

  const puzzle = await getTodayPuzzle();
  if (!puzzle) {
    return NextResponse.json({ error: 'no puzzle scheduled for today' }, { status: 404 });
  }

  await recordPuzzleLoad(sessionId, puzzle.id);

  return NextResponse.json({
    dayNumber: puzzle.dayNumber,
    date: puzzle.date,
    grid: puzzle.grid,
  });
}
