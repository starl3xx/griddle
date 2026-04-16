import { NextResponse } from 'next/server';
import { getSessionId } from '@/lib/session';
import { getPuzzleByDay, recordPuzzleLoad } from '@/lib/db/queries';

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

  const sessionId = await getSessionId();
  const puzzle = await getPuzzleByDay(dayNumber);
  if (!puzzle) {
    return NextResponse.json({ error: 'no puzzle for that day' }, { status: 404 });
  }

  await recordPuzzleLoad(sessionId, puzzle.id);

  return NextResponse.json({
    dayNumber: puzzle.dayNumber,
    date: puzzle.date,
    grid: puzzle.grid,
  });
}
