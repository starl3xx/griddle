import { and, eq } from 'drizzle-orm';
import { db } from './client';
import { puzzles, puzzleLoads } from './schema';
import { getCurrentDayNumber } from '@/lib/scheduler';

/**
 * Server-side puzzle/solve queries shared between the server component
 * (`app/page.tsx`) and the API route (`app/api/puzzle/today/route.ts`).
 *
 * `lib/db/client.ts` is the singleton Drizzle client. This module layers
 * query helpers on top so the business logic lives in one place.
 */

export interface TodayPuzzlePayload {
  /** Internal DB id (not sent to client). */
  id: number;
  /** Day number (1-indexed, matches scheduler.getCurrentDayNumber). */
  dayNumber: number;
  /** ISO date (YYYY-MM-DD) this puzzle is scheduled for. */
  date: string;
  /** 9-letter grid string, to be shown to the player. */
  grid: string;
}

/**
 * Read today's puzzle row. Returns null if no puzzle is seeded for the
 * current day (which should never happen in steady-state but would
 * surface as a 404 rather than a 500 if it did).
 *
 * **The `word` column is intentionally omitted from the return type** —
 * every caller of this function is on the path to the client, and the
 * word must never leak. Solve verification uses a separate query that
 * pulls `word` explicitly.
 */
export async function getTodayPuzzle(): Promise<TodayPuzzlePayload | null> {
  const dayNumber = getCurrentDayNumber();
  const rows = await db
    .select({
      id: puzzles.id,
      dayNumber: puzzles.dayNumber,
      date: puzzles.date,
      grid: puzzles.grid,
    })
    .from(puzzles)
    .where(eq(puzzles.dayNumber, dayNumber))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Record that `sessionId` first saw `puzzleId` at now(). Idempotent via
 * `ON CONFLICT DO NOTHING` — later loads of the same puzzle by the same
 * session keep the earliest `loaded_at`, which is the correct start
 * time for `server_solve_ms`.
 */
export async function recordPuzzleLoad(sessionId: string, puzzleId: number): Promise<void> {
  await db
    .insert(puzzleLoads)
    .values({ sessionId, puzzleId })
    .onConflictDoNothing({ target: [puzzleLoads.sessionId, puzzleLoads.puzzleId] });
}

/**
 * Fetch the puzzle answer word by dayNumber. Only used from solve
 * verification — never call this from any code path that touches the
 * client response.
 */
export async function getPuzzleWordByDayNumber(
  dayNumber: number,
): Promise<{ id: number; word: string } | null> {
  const rows = await db
    .select({ id: puzzles.id, word: puzzles.word })
    .from(puzzles)
    .where(eq(puzzles.dayNumber, dayNumber))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Fetch the loaded_at timestamp for a (session, puzzle) pair. Returns
 * null if the session never called /api/puzzle/today for this puzzle
 * before submitting a solve — in which case the solve is still counted
 * but `server_solve_ms` is null.
 */
export async function getPuzzleLoadedAt(
  sessionId: string,
  dayNumber: number,
): Promise<Date | null> {
  const rows = await db
    .select({ loadedAt: puzzleLoads.loadedAt })
    .from(puzzleLoads)
    .innerJoin(puzzles, eq(puzzleLoads.puzzleId, puzzles.id))
    .where(and(eq(puzzleLoads.sessionId, sessionId), eq(puzzles.dayNumber, dayNumber)))
    .limit(1);
  if (rows.length === 0) return null;
  return new Date(rows[0].loadedAt);
}
