import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from './client';
import { puzzles, puzzleLoads, solves } from './schema';
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
 * Cache-safe wrappers around Upstash. Every kv.get / kv.set call goes
 * through these so a transient Upstash failure (network blip, rate
 * limit, brief outage) never breaks the request — we just log and fall
 * through to the DB. The cache is a performance optimization, NOT an
 * availability dependency. The non-cached version of these queries
 * worked fine; the cached version must never be *less* resilient.
 */
async function safeKvGet<T>(key: string): Promise<T | null> {
  try {
    return await kv.get<T>(key);
  } catch (err) {
    console.warn(`[kv] get failed for ${key}:`, err);
    return null;
  }
}

async function safeKvSet<T>(key: string, value: T, ttl: number): Promise<void> {
  try {
    await kv.set(key, value, { ex: ttl });
  } catch (err) {
    console.warn(`[kv] set failed for ${key}:`, err);
  }
}

/**
 * Read today's puzzle row. Returns null if no puzzle is seeded for the
 * current day. Reads from Upstash first; on miss (or kv error), queries
 * Neon and populates BOTH the public and answer caches in a single
 * roundtrip so the next /api/solve hit also gets a cache hit.
 */
export async function getTodayPuzzle(): Promise<TodayPuzzlePayload | null> {
  const dayNumber = getCurrentDayNumber();

  const cached = await safeKvGet<TodayPuzzlePayload>(PUBLIC_KEY(dayNumber));
  if (cached) return cached;

  const row = await refreshCacheForDay(dayNumber);
  return row ? toPublicPayload(row) : null;
}

/**
 * Fetch the puzzle answer word by dayNumber. Only used from solve
 * verification — never call this from any code path that touches the
 * client response.
 */
export async function getPuzzleWordByDayNumber(
  dayNumber: number,
): Promise<PuzzleAnswer | null> {
  const cached = await safeKvGet<PuzzleAnswer>(ANSWER_KEY(dayNumber));
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

  // Two cache keys, populated in parallel via safeKvSet so a transient
  // Upstash failure can never block returning the freshly-fetched row.
  // Public key intentionally omits the word — type-level word stripping
  // carried over from the non-cached version.
  await Promise.all([
    safeKvSet(PUBLIC_KEY(dayNumber), toPublicPayload(row), ttl),
    safeKvSet(ANSWER_KEY(dayNumber), { id: row.id, word: row.word }, ttl),
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
 * Daily leaderboard row — one wallet, their fastest legitimate solve.
 */
export interface LeaderboardEntry {
  rank: number;
  wallet: string;
  serverSolveMs: number;
  unassisted: boolean;
}

/**
 * Top N solvers for a given day. Filters:
 *   - solved = true (no failed attempts)
 *   - flag IS NULL (no ineligible/suspicious — anti-bot drops them)
 *   - wallet IS NOT NULL (no anonymous solves on the leaderboard)
 *
 * Each wallet appears once with their fastest serverSolveMs. Drizzle
 * `selectDistinctOn` would be cleaner but isn't available across all
 * dialects we care about, so we use a raw window function over the
 * result. For ~100 row leaderboards this is fast enough that the
 * extra complexity isn't worth optimizing.
 */
export async function getDailyLeaderboard(
  dayNumber: number,
  limit = 100,
): Promise<LeaderboardEntry[]> {
  const puzzleRows = await db
    .select({ id: puzzles.id })
    .from(puzzles)
    .where(eq(puzzles.dayNumber, dayNumber))
    .limit(1);
  if (puzzleRows.length === 0) return [];
  const puzzleId = puzzleRows[0].id;

  // Pull all eligible solves for the puzzle, sorted by speed. Walk the
  // result once and keep the first occurrence per wallet — that's their
  // fastest. For a real puzzle this is at most ~hundreds of rows; for
  // viral days we can swap to DISTINCT ON later.
  const rows = await db
    .select({
      wallet: solves.wallet,
      serverSolveMs: solves.serverSolveMs,
      unassisted: solves.unassisted,
    })
    .from(solves)
    .where(
      and(
        eq(solves.puzzleId, puzzleId),
        eq(solves.solved, true),
        isNull(solves.flag),
        isNotNull(solves.wallet),
        isNotNull(solves.serverSolveMs),
      ),
    )
    .orderBy(asc(solves.serverSolveMs));

  const seen = new Set<string>();
  const result: LeaderboardEntry[] = [];
  for (const row of rows) {
    if (!row.wallet || row.serverSolveMs == null) continue;
    if (seen.has(row.wallet)) continue;
    seen.add(row.wallet);
    result.push({
      rank: result.length + 1,
      wallet: row.wallet,
      serverSolveMs: row.serverSolveMs,
      unassisted: row.unassisted,
    });
    if (result.length >= limit) break;
  }
  return result;
}

/**
 * Recent flagged solves for the admin anomaly dashboard. Returns the
 * latest N rows where flag IS NOT NULL, ordered by created_at DESC.
 * The flag is set by /api/solve based on the env-tunable thresholds
 * (ineligible / suspicious). Admin can review these to spot bots.
 */
export interface AnomalyRow {
  id: number;
  puzzleId: number;
  wallet: string | null;
  sessionId: string;
  serverSolveMs: number | null;
  clientSolveMs: number | null;
  keystrokeStddevMs: number | null;
  keystrokeMinMs: number | null;
  keystrokeCount: number | null;
  flag: 'ineligible' | 'suspicious';
  createdAt: Date;
}

export async function getRecentAnomalies(limit = 200): Promise<AnomalyRow[]> {
  const rows = await db
    .select({
      id: solves.id,
      puzzleId: solves.puzzleId,
      wallet: solves.wallet,
      sessionId: solves.sessionId,
      serverSolveMs: solves.serverSolveMs,
      clientSolveMs: solves.clientSolveMs,
      keystrokeStddevMs: solves.keystrokeStddevMs,
      keystrokeMinMs: solves.keystrokeMinMs,
      keystrokeCount: solves.keystrokeCount,
      flag: solves.flag,
      createdAt: solves.createdAt,
    })
    .from(solves)
    .where(isNotNull(solves.flag))
    .orderBy(sql`${solves.createdAt} DESC`)
    .limit(limit);
  return rows.map((r) => ({
    ...r,
    flag: r.flag as 'ineligible' | 'suspicious',
  }));
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
