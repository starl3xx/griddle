import { NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { solves } from '@/lib/db/schema';
import { getSessionId } from '@/lib/session';
import {
  getPuzzleLoadAndStart,
  getPuzzleWordByDayNumber,
  updateStreakForSolve,
  getLifetimeSolveCount,
  getFirstSuccessfulSolveForPuzzle,
  getPostSolveSummary,
  getCurrentStreakForIdentity,
} from '@/lib/db/queries';
import { getCurrentDayNumber } from '@/lib/scheduler';
import { getSessionWallet } from '@/lib/wallet-session';
import { getSessionProfile } from '@/lib/session-profile';
import { awardWordmarks } from '@/lib/wordmarks/award';
import { isSessionPremium } from '@/lib/premium-check';

/**
 * POST /api/solve
 *
 * Server-side solve verification. The client sends its claimed word
 * plus timing telemetry; the server:
 *
 *   1. Looks up the puzzle word by day number (this is the ONLY place
 *      the word is read from the DB on a path that touches a response)
 *   2. Compares claimedWord === puzzle.word
 *   3. Computes `server_solve_ms` from `puzzle_loads.started_at` (the
 *      moment the player pressed Start). Falls back to `loaded_at` when
 *      started_at is null — direct POSTs, or rows that pre-date the
 *      Start gate.
 *   4. Computes keystroke stddev and min from the intervals array
 *   5. Determines the anti-bot flag (ineligible / suspicious / null)
 *   6. Inserts a `solves` row with all of the above
 *   7. Returns the verdict
 *
 * Flag thresholds are env-tunable (BOT_THRESHOLD_* vars) so we can raise
 * or lower them post-launch without a code deploy.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const INELIGIBLE_MS = parseInt(process.env.BOT_THRESHOLD_INELIGIBLE_MS ?? '2000', 10);
const SUSPICIOUS_MS = parseInt(process.env.BOT_THRESHOLD_SUSPICIOUS_MS ?? '6000', 10);
const SUSPICIOUS_STDDEV_MS = parseInt(process.env.BOT_THRESHOLD_STDDEV_MS ?? '30', 10);

// A real solve has 8 inter-keystroke intervals (9 letters → 8 gaps).
// Backspaces inside an attempt rarely push it past ~50 events. 1000
// is a generous upper bound — a request claiming more is malformed
// and we reject it outright rather than try to process it.
const MAX_KEYSTROKE_INTERVALS = 1000;

// Wordmarks fields — bounds match the UI surface. A real attempt
// tops out at maybe a few dozen Crumbs and a hundred backspaces;
// these caps are deliberately generous so we don't reject real
// edge-case play but small enough to reject obviously malformed
// payloads without a DB round-trip.
const MAX_FOUND_WORDS = 200;
const MAX_BACKSPACE_COUNT = 2000;
const MAX_RESET_COUNT = 200;

interface SolveRequestBody {
  dayNumber: number;
  claimedWord: string;
  clientSolveMs: number;
  keystrokeIntervalsMs: number[];
  keystrokeCount: number;
  unassisted?: boolean;
  /**
   * Wordmark-driving fields. All optional for
   * backwards-compatibility with older client bundles mid-deploy —
   * a null/missing field just means "don't award wordmarks that
   * depend on this counter" rather than a hard rejection.
   */
  backspaceCount?: number;
  resetCount?: number;
  foundWords?: string[];
}

interface SolveResponseBody {
  solved: boolean;
  serverSolveMs: number | null;
  flag: 'ineligible' | 'suspicious' | null;
  /** Present only on a successful solve. */
  word?: string;
  /**
   * Wordmark ids earned by this solve — newly inserted, not
   * historical. Empty array on a failed or non-awarding solve.
   * Used by the SolveModal earn toast.
   */
  earnedWordmarks?: string[];
  /**
   * Post-solve stats payload consumed by the revamped SolveModal. All
   * fields null-safe so the modal degrades gracefully: anonymous / old-
   * client / query-failure paths just hide the affected section rather
   * than failing the whole solve response.
   */
  currentStreak: number | null;
  averageMs: number | null;
  percentileRank: number | null;
  dailyRank: number | null;
  isPremium: boolean;
}

export async function POST(
  req: Request,
): Promise<NextResponse<SolveResponseBody | { error: string }>> {
  let body: SolveRequestBody;
  try {
    body = (await req.json()) as SolveRequestBody;
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }

  if (
    typeof body.dayNumber !== 'number' ||
    typeof body.claimedWord !== 'string' ||
    body.claimedWord.length !== 9 ||
    !Array.isArray(body.keystrokeIntervalsMs) ||
    body.keystrokeIntervalsMs.length > MAX_KEYSTROKE_INTERVALS ||
    !body.keystrokeIntervalsMs.every(
      (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0,
    ) ||
    typeof body.clientSolveMs !== 'number' ||
    !Number.isFinite(body.clientSolveMs) ||
    typeof body.keystrokeCount !== 'number' ||
    !Number.isFinite(body.keystrokeCount)
  ) {
    return NextResponse.json({ error: 'malformed solve payload' }, { status: 400 });
  }

  // Wordmark fields — optional, but if provided must be the right
  // shape. Rejecting here (rather than sanitizing) keeps the contract
  // strict: a client bug is louder than a silent zero.
  if (
    (body.backspaceCount !== undefined &&
      (typeof body.backspaceCount !== 'number' ||
        !Number.isInteger(body.backspaceCount) ||
        body.backspaceCount < 0 ||
        body.backspaceCount > MAX_BACKSPACE_COUNT)) ||
    (body.resetCount !== undefined &&
      (typeof body.resetCount !== 'number' ||
        !Number.isInteger(body.resetCount) ||
        body.resetCount < 0 ||
        body.resetCount > MAX_RESET_COUNT)) ||
    (body.foundWords !== undefined &&
      (!Array.isArray(body.foundWords) ||
        body.foundWords.length > MAX_FOUND_WORDS ||
        !body.foundWords.every(
          (w) => typeof w === 'string' && w.length >= 4 && w.length <= 8,
        )))
  ) {
    return NextResponse.json({ error: 'malformed wordmark payload' }, { status: 400 });
  }

  // Preserve `undefined` for missing counts via `?? null`. Defaulting
  // to 0 would incorrectly award Blameless to every solve from an
  // old client bundle mid-deploy: the award check
  // `backspaceCount === 0 && resetCount === 0` would trivially pass.
  // Null is the "unknown — don't evaluate rules that need this" sentinel
  // and awardWordmarks skips Blameless when either count is null.
  //
  // We persist the same null values to the DB (not a coerced 0). The
  // `backspace_count` / `reset_count` columns are nullable, and null
  // here honestly represents "old client didn't tell us". Admin
  // aggregations that SUM/AVG these columns need to COALESCE to 0 or
  // filter WHERE NOT NULL — writing a 0 here would silently mix
  // "didn't hit backspace" with "didn't tell us whether they did",
  // which would be strictly worse for analytics correctness.
  //
  // `foundWords ?? []` stays — an empty array correctly suppresses
  // both Wordsmith (>= 9) and Labyrinth (any 8-letter crumb) since
  // neither can match an empty list.
  const backspaceCount: number | null = body.backspaceCount ?? null;
  const resetCount: number | null = body.resetCount ?? null;
  const foundWords = [...new Set(body.foundWords ?? [])];

  // Allow solves for today’s puzzle and past (archive) puzzles, but
  // reject future days — same guard as /api/puzzle/[day].
  const todayDayNumber = getCurrentDayNumber();
  if (body.dayNumber > todayDayNumber) {
    return NextResponse.json(
      { error: 'solve not accepted for future puzzles' },
      { status: 403 },
    );
  }

  const sessionId = await getSessionId();

  // Look up the puzzle, the session's load time, and both session
  // bindings in parallel. `wallet` attributes the solve to the unlock
  // ledger / leaderboard the way it always has; `profileId` is the
  // canonical identity for stats (new in this PR) so handle-only and
  // email-auth users — who may never bind a wallet — still see their
  // own solves. A solve can carry both, one, or neither.
  const [puzzle, loadAndStart, wallet, profileId, isPremium] = await Promise.all([
    getPuzzleWordByDayNumber(body.dayNumber),
    getPuzzleLoadAndStart(sessionId, body.dayNumber),
    getSessionWallet(sessionId),
    getSessionProfile(sessionId),
    isSessionPremium(sessionId),
  ]);

  if (!puzzle) {
    return NextResponse.json({ error: 'puzzle not found' }, { status: 404 });
  }

  const claimed = body.claimedWord.toLowerCase();
  const solved = claimed === puzzle.word;

  // First-solve-wins. If this identity already has a successful solve
  // for this puzzle, the replay is a no-op: don't insert a new row,
  // don't re-award wordmarks, and echo back the original serverSolveMs
  // and flag so the client modal shows the authoritative first time
  // (not the replay time). Only applies to identified users; anonymous
  // session-only solves fall through to the normal insert path because
  // they carry no cross-device identity to dedupe against.
  const identifiable = wallet != null || profileId != null;
  const identity = { profileId, wallet };
  if (solved && identifiable) {
    const prior = await getFirstSuccessfulSolveForPuzzle(identity, puzzle.id);
    if (prior != null) {
      // Replay path: the solve row already exists. Surface the stats
      // anyway so the modal looks the same whether it's a fresh solve
      // or a post-refresh re-trigger. Skip the streak update (this
      // isn't a new solve) but still report the stored streak.
      //
      // Wrapped in try/catch for the same reason the fresh-solve pipe
      // is: the replay itself has already "succeeded" (the original
      // solve row stands) so a transient stats failure must not 500
      // the response — just serve nulls and let the modal degrade.
      let summary = { averageMs: null as number | null, percentileRank: null as number | null, dailyRank: null as number | null };
      let currentStreak: number | null = null;
      try {
        const [summaryResult, streakResult] = await Promise.all([
          getPostSolveSummary(identity, body.dayNumber, { isPremium }),
          getCurrentStreakForIdentity(identity),
        ]);
        summary = summaryResult;
        currentStreak = streakResult;
      } catch (err) {
        console.error('[solve] replay-path summary failed', err);
      }
      return NextResponse.json({
        solved: true,
        serverSolveMs: prior.serverSolveMs,
        flag: prior.flag,
        word: puzzle.word,
        earnedWordmarks: [],
        currentStreak,
        averageMs: summary.averageMs,
        percentileRank: summary.percentileRank,
        dailyRank: summary.dailyRank,
        isPremium,
      });
    }
  }

  // Authoritative server-side timing. Prefer started_at (the moment
  // the player pressed Start); fall back to loaded_at for rows that
  // pre-date the Start gate or for direct POSTs that skipped the gate.
  // Null only when neither exists, which means the session submitted
  // without first loading the puzzle — solve still counts, no time.
  const clockStart = loadAndStart?.startedAt ?? loadAndStart?.loadedAt ?? null;
  const serverSolveMs =
    clockStart != null ? Math.max(0, Date.now() - clockStart.getTime()) : null;

  const { stddev: keystrokeStddevMs, min: keystrokeMinMs } = keystrokeStats(
    body.keystrokeIntervalsMs,
  );

  const flag: 'ineligible' | 'suspicious' | null =
    serverSolveMs != null && serverSolveMs < INELIGIBLE_MS
      ? 'ineligible'
      : (serverSolveMs != null && serverSolveMs < SUSPICIOUS_MS) ||
          (keystrokeStddevMs != null && keystrokeStddevMs < SUSPICIOUS_STDDEV_MS)
        ? 'suspicious'
        : null;

  await db.insert(solves).values({
    puzzleId: puzzle.id,
    sessionId,
    wallet,
    profileId,
    solved,
    bestWord: solved ? claimed : null,
    clientSolveMs: body.clientSolveMs,
    serverSolveMs,
    keystrokeIntervalsMs: body.keystrokeIntervalsMs,
    keystrokeCount: body.keystrokeCount,
    keystrokeStddevMs,
    keystrokeMinMs,
    backspaceCount,
    resetCount,
    foundWords,
    unassisted: body.unassisted ?? false,
    flag,
  });

  // Wordmarks are awarded on any successful solve that has SOME
  // identity (wallet OR profile_id). Anonymous session-only solves
  // bypass the pipeline since they have nowhere to store the award.
  let earnedWordmarks: string[] = [];
  let currentStreak: number | null = null;
  let summary: { averageMs: number | null; percentileRank: number | null; dailyRank: number | null } = {
    averageMs: null,
    percentileRank: null,
    dailyRank: null,
  };
  if (solved && identifiable) {
    try {
      // Flagged solves (ineligible / suspicious) must not advance the
      // streak — a bot chaining flagged solves could otherwise farm
      // Fireproof / Steadfast / Centurion. Skip the write and pass
      // currentStreak=0 so streak wordmarks are unreachable for flagged
      // solves. Milestone + skill wordmarks still fire (botFlagged
      // already suppresses speed wordmarks inside awardWordmarks).
      //
      // The post-solve summary runs in parallel with streak update +
      // lifetime count: all three are read-mostly and independent.
      const [streakResult, lifetimeSolves, summaryResult] = await Promise.all([
        flag === null
          ? updateStreakForSolve(identity, body.dayNumber)
          : Promise.resolve({ currentStreak: 0, longestStreak: 0 }),
        getLifetimeSolveCount(identity),
        getPostSolveSummary(identity, body.dayNumber, { isPremium }),
      ]);
      currentStreak = streakResult.currentStreak;
      summary = summaryResult;
      earnedWordmarks = await awardWordmarks({
        wallet,
        profileId,
        puzzleId: puzzle.id,
        puzzleWord: puzzle.word,
        solveTimeMs: serverSolveMs,
        unassisted: body.unassisted ?? false,
        backspaceCount,
        resetCount,
        foundWords,
        lifetimeSolves,
        currentStreak: streakResult.currentStreak,
        botFlagged: flag !== null,
      });
    } catch (err) {
      // Wordmark / summary computation is best-effort — a failure
      // MUST NOT surface as a 500. The solve row is already
      // committed above and the player's primary feedback (solved +
      // time) is what matters. Log and return with null stats.
      console.error('[solve] post-solve pipeline failed', err);
      earnedWordmarks = [];
    }
  }

  return NextResponse.json({
    solved,
    serverSolveMs,
    flag,
    word: solved ? puzzle.word : undefined,
    earnedWordmarks,
    currentStreak,
    averageMs: summary.averageMs,
    percentileRank: summary.percentileRank,
    dailyRank: summary.dailyRank,
    isPremium,
  });
}

function keystrokeStats(intervals: number[]): {
  stddev: number | null;
  min: number | null;
} {
  // Loop-based instead of `Math.min(...intervals)` because the spread
  // operator passes each element as a function argument, which blows
  // the call stack for arrays past ~1e5 elements. The route validation
  // already rejects non-finite elements at the input boundary, but
  // this helper still filters defensively so a future caller that
  // bypasses validation can’t produce nonsense stats.
  //
  // Critical: mean and variance MUST divide by `validCount`, not
  // `intervals.length`. Otherwise a bot could pad the array with NaN /
  // Infinity entries to inflate the computed stddev and evade the
  // SUSPICIOUS_STDDEV_MS check. The route validation catches that
  // attack at the boundary; the validCount denominator is the
  // second line of defense.
  let sum = 0;
  let min = Infinity;
  let validCount = 0;
  for (const v of intervals) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    sum += v;
    if (v < min) min = v;
    validCount++;
  }
  if (validCount === 0) return { stddev: null, min: null };

  const mean = sum / validCount;
  let varianceSum = 0;
  for (const v of intervals) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    varianceSum += (v - mean) ** 2;
  }
  const variance = varianceSum / validCount;
  return {
    stddev: Math.round(Math.sqrt(variance)),
    min: Number.isFinite(min) ? min : null,
  };
}
