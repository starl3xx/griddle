import { NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { solves } from '@/lib/db/schema';
import { getSessionId } from '@/lib/session';
import {
  getPuzzleLoadedAt,
  getPuzzleWordByDayNumber,
} from '@/lib/db/queries';

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
    typeof body.clientSolveMs !== 'number' ||
    typeof body.keystrokeCount !== 'number'
  ) {
    return NextResponse.json({ error: 'malformed solve payload' }, { status: 400 });
  }

  const sessionId = await getSessionId();

  // Look up the puzzle and the session’s load time in parallel.
  const [puzzle, loadedAt] = await Promise.all([
    getPuzzleWordByDayNumber(body.dayNumber),
    getPuzzleLoadedAt(sessionId, body.dayNumber),
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
  if (intervals.length === 0) return { stddev: null, min: null };
  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const variance =
    intervals.reduce((acc, v) => acc + (v - mean) ** 2, 0) / intervals.length;
  return {
    stddev: Math.round(Math.sqrt(variance)),
    min: Math.min(...intervals),
  };
}
