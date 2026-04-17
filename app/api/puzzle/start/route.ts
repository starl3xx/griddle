import { NextResponse } from 'next/server';
import { getSessionId } from '@/lib/session';
import { getCurrentDayNumber } from '@/lib/scheduler';
import { getPuzzleWordByDayNumber, markPuzzleStarted } from '@/lib/db/queries';

/**
 * POST /api/puzzle/start
 *
 * Stamps `puzzle_loads.started_at` = NOW() for this (session, puzzle)
 * the first time the player presses the Start button. First-Start-wins:
 * subsequent calls are no-ops (COALESCE inside markPuzzleStarted keeps
 * the original timestamp). The solve route times from the returned
 * `started_at`, falling back to `loaded_at` only for pre-start direct
 * POSTs or rows that pre-date this feature.
 *
 * Body: `{ dayNumber: number }`
 * Response: `{ startedAt: ISO8601 }` — authoritative server time.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface StartRequestBody {
  dayNumber: number;
}

export async function POST(
  req: Request,
): Promise<NextResponse<{ startedAt: string } | { error: string }>> {
  let body: StartRequestBody;
  try {
    body = (await req.json()) as StartRequestBody;
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }

  if (typeof body.dayNumber !== 'number' || !Number.isInteger(body.dayNumber)) {
    return NextResponse.json({ error: 'malformed start payload' }, { status: 400 });
  }

  // Reject future puzzles for the same reason /api/solve does — the
  // route shouldn't mint a timer for a puzzle the player can't yet
  // solve.
  if (body.dayNumber > getCurrentDayNumber()) {
    return NextResponse.json(
      { error: 'puzzle not available yet' },
      { status: 403 },
    );
  }

  const [sessionId, puzzle] = await Promise.all([
    getSessionId(),
    getPuzzleWordByDayNumber(body.dayNumber),
  ]);

  if (!puzzle) {
    return NextResponse.json({ error: 'puzzle not found' }, { status: 404 });
  }

  const startedAt = await markPuzzleStarted(sessionId, puzzle.id);
  return NextResponse.json({ startedAt: startedAt.toISOString() });
}
