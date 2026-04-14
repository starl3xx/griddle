import { and, eq } from 'drizzle-orm';
import { db } from './client';
import { puzzles, puzzleLoads } from './schema';
import { getCurrentDayNumber } from '@/lib/scheduler';
import { secondsUntilUtcMidnight } from '@/lib/format';
import { kv } from '@/lib/kv';

/**
 * Server-side puzzle/solve queries shared between the server component
 * (`app/page.tsx`) and the API route (`app/api/puzzle/today/route.ts`).
 *
 * Read-through cache layer in front of Neon: every per-day puzzle row
 * is the same for every user, so we cache it in Upstash with a TTL that
 * rolls over at the next UTC midnight (when the daily puzzle changes).
 *
 * **Cache key separation is a security boundary, not just an optimization.**
 * The public payload (no word) and the answer word live under DIFFERENT
 * cache keys so a future contributor literally cannot accidentally serve
 * the answer to a public surface — `getTodayPuzzle()` only ever reads
 * from the public key. Same type-level guarantee that the original
 * non-cached version had.
 */

/** Public puzzle payload — sent to the client. NEVER includes the word. */
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

/** Server-only payload — used by /api/solve to verify the claim. */
interface PuzzleAnswer {
  id: number;
  word: string;
}

const PUBLIC_KEY = (dayNumber: number) => `griddle:puzzle:public:${dayNumber}`;
const ANSWER_KEY = (dayNumber: number) => `griddle:puzzle:answer:${dayNumber}`;

/**
 * Read today's puzzle row. Returns null if no puzzle is seeded for the
 * current day. Reads from Upstash first; on miss, queries Neon and
 * populates BOTH the public and answer caches in a single roundtrip
 * so the next /api/solve hit also gets a cache hit.
 */
export async function getTodayPuzzle(): Promise<TodayPuzzlePayload | null> {
  const dayNumber = getCurrentDayNumber();

  const cached = await kv.get<TodayPuzzlePayload>(PUBLIC_KEY(dayNumber));
  if (cached) return cached;

  return refreshCacheForDay(dayNumber).then((row) =>
    row ? toPublicPayload(row) : null,
  );
}

/**
 * Fetch the puzzle answer word by dayNumber. Only used from solve
 * verification — never call this from any code path that touches the
 * client response.
 */
export async function getPuzzleWordByDayNumber(
  dayNumber: number,
): Promise<PuzzleAnswer | null> {
  const cached = await kv.get<PuzzleAnswer>(ANSWER_KEY(dayNumber));
  if (cached) return cached;

  const row = await refreshCacheForDay(dayNumber);
  return row ? { id: row.id, word: row.word } : null;
}

/**
 * Cold-cache path: query Neon once for the full row and populate both
 * cache keys in parallel. Called from `getTodayPuzzle` and
 * `getPuzzleWordByDayNumber` on a miss — whichever fires first warms
 * the cache for the other.
 *
 * TTL is `secondsUntilUtcMidnight()` so the cached row expires exactly
 * when the daily puzzle rolls over. Avoids serving yesterday’s puzzle
 * after midnight.
 */
async function refreshCacheForDay(dayNumber: number): Promise<{
  id: number;
  dayNumber: number;
  date: string;
  grid: string;
  word: string;
} | null> {
  const rows = await db
    .select({
      id: puzzles.id,
      dayNumber: puzzles.dayNumber,
      date: puzzles.date,
      grid: puzzles.grid,
      word: puzzles.word,
    })
    .from(puzzles)
    .where(eq(puzzles.dayNumber, dayNumber))
    .limit(1);
  if (rows.length === 0) return null;
  const row = rows[0];

  // TTL must be ≥ 1 — Upstash rejects 0. If we’re within the same
  // second as midnight, fall back to a 60-second TTL.
  const ttl = Math.max(60, secondsUntilUtcMidnight());

  // Two cache keys, populated in parallel. Public key intentionally
  // omits the word — type-level word stripping carried over from the
  // non-cached version.
  await Promise.all([
    kv.set(PUBLIC_KEY(dayNumber), toPublicPayload(row), { ex: ttl }),
    kv.set(ANSWER_KEY(dayNumber), { id: row.id, word: row.word }, { ex: ttl }),
  ]);

  return row;
}

function toPublicPayload(row: {
  id: number;
  dayNumber: number;
  date: string;
  grid: string;
}): TodayPuzzlePayload {
  return {
    id: row.id,
    dayNumber: row.dayNumber,
    date: row.date,
    grid: row.grid,
  };
}

/**
 * Record that `sessionId` first saw `puzzleId` at now(). Idempotent via
 * `ON CONFLICT DO NOTHING` — later loads of the same puzzle by the same
 * session keep the earliest `loaded_at`, which is the correct start
 * time for `server_solve_ms`.
 *
 * NOT cached: this is a write-only path and each row is per-session,
 * so there’s no shared row to cache.
 */
export async function recordPuzzleLoad(sessionId: string, puzzleId: number): Promise<void> {
  await db
    .insert(puzzleLoads)
    .values({ sessionId, puzzleId })
    .onConflictDoNothing({ target: [puzzleLoads.sessionId, puzzleLoads.puzzleId] });
}

/**
 * Fetch the loaded_at timestamp for a (session, puzzle) pair. Returns
 * null if the session never called /api/puzzle/today for this puzzle
 * before submitting a solve.
 *
 * NOT cached: per-session, per-puzzle, low cache-hit-rate. Direct DB read.
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
