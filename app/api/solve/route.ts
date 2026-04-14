import { NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { solves } from '@/lib/db/schema';
import { getSessionId } from '@/lib/session';
import {
  getPuzzleLoadedAt,
  getPuzzleWordByDayNumber,
} from '@/lib/db/queries';
import { getCurrentDayNumber } from '@/lib/scheduler';
import { getSessionWallet } from '@/lib/wallet-session';

/**
 * POST /api/solve
 *
 * Server-side solve verification. The client sends its claimed word
 * plus timing telemetry; the server:
 *
 *   1. Looks up the puzzle word by day number (this is the ONLY place
 *      the word is read from the DB on a path that touches a response)
 *   2. Compares claimedWord === puzzle.word
 *   3. Computes `server_solve_ms` from `puzzle_loads.loaded_at`
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

const INELIGIBLE_MS = parseInt(process.env.BOT_THRESHOLD_INELIGIBLE_MS ?? '8000', 10);
const SUSPICIOUS_MS = parseInt(process.env.BOT_THRESHOLD_SUSPICIOUS_MS ?? '15000', 10);
const SUSPICIOUS_STDDEV_MS = parseInt(process.env.BOT_THRESHOLD_STDDEV_MS ?? '30', 10);

// A real solve has 8 inter-keystroke intervals (9 letters → 8 gaps).
// Backspaces inside an attempt rarely push it past ~50 events. 1000
// is a generous upper bound — a request claiming more is malformed
// and we reject it outright rather than try to process it.
const MAX_KEYSTROKE_INTERVALS = 1000;

interface SolveRequestBody {
  dayNumber: number;
  claimedWord: string;
  clientSolveMs: number;
  keystrokeIntervalsMs: number[];
  keystrokeCount: number;
  unassisted?: boolean;
}

interface SolveResponseBody {
  solved: boolean;
  serverSolveMs: number | null;
  flag: 'ineligible' | 'suspicious' | null;
  /** Present only on a successful solve. */
  word?: string;
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

  // Clamp dayNumber to today’s puzzle. M4b only allows submitting solves
  // for the current day — past puzzles bypass anti-bot timing checks
  // (no puzzle_loads → null serverSolveMs → no flag). M5 will relax
  // this when the premium archive feature ships, gated by wallet auth.
  const todayDayNumber = getCurrentDayNumber();
  if (body.dayNumber !== todayDayNumber) {
    return NextResponse.json(
      { error: 'solve only accepted for today’s puzzle' },
      { status: 403 },
    );
  }

  const sessionId = await getSessionId();

  // Look up the puzzle, the session’s load time, and the session’s
  // bound wallet (if any) in parallel. The wallet binding is set by
  // POST /api/wallet/link when the user connects, so any solve made
  // AFTER connecting gets attributed automatically without the client
  // having to pass the wallet (and without the server trusting client
  // claims about wallet ownership).
  const [puzzle, loadedAt, wallet] = await Promise.all([
    getPuzzleWordByDayNumber(body.dayNumber),
    getPuzzleLoadedAt(sessionId, body.dayNumber),
    getSessionWallet(sessionId),
  ]);

  if (!puzzle) {
    return NextResponse.json({ error: 'puzzle not found' }, { status: 404 });
  }

  const claimed = body.claimedWord.toLowerCase();
  const solved = claimed === puzzle.word;

  // Authoritative server-side timing. Null if the session submitted
  // without first loading the puzzle (possible via direct POST) — in
  // that case the solve still counts but has no server time.
  const serverSolveMs =
    loadedAt != null ? Math.max(0, Date.now() - loadedAt.getTime()) : null;

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
    solved,
    bestWord: solved ? claimed : null,
    clientSolveMs: body.clientSolveMs,
    serverSolveMs,
    keystrokeIntervalsMs: body.keystrokeIntervalsMs,
    keystrokeCount: body.keystrokeCount,
    keystrokeStddevMs,
    keystrokeMinMs,
    unassisted: body.unassisted ?? false,
    flag,
  });

  return NextResponse.json({
    solved,
    serverSolveMs,
    flag,
    word: solved ? puzzle.word : undefined,
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
