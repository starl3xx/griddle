import { NextResponse } from 'next/server';
import { getDailyLeaderboard } from '@/lib/db/queries';
import { getCurrentDayNumber } from '@/lib/scheduler';
import { getSessionId } from '@/lib/session';
import { isSessionPremium } from '@/lib/premium-check';

/**
 * GET /api/leaderboard/[day]
 *
 * Returns the top 100 ranked solves for a given puzzle day, fastest
 * first. Each player (profile or wallet) appears once at their best time.
 *
 * Premium-gated: non-premium sessions get 403 so the data never leaks
 * via a direct API hit, matching the standalone /leaderboard/[day] and
 * in-app LeaderboardPanel gates. The in-app panel only fetches when the
 * client already sees `premium=true`, so legit callers pass through.
 *
 * Filters: solved + non-anonymous + flag-clean. Suspicious/ineligible
 * solves are excluded; the leaderboard is the curated list of legit
 * human solves.
 *
 * Future puzzles are clamped to today to prevent leaderboard-poking
 * before the puzzle is live.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ day: string }> },
): Promise<NextResponse> {
  const { day } = await params;
  const requested = parseInt(day, 10);
  if (!Number.isFinite(requested) || requested < 1) {
    return NextResponse.json({ error: 'invalid day' }, { status: 400 });
  }

  const sessionId = await getSessionId();
  const premium = await isSessionPremium(sessionId);
  if (!premium) {
    return NextResponse.json({ error: 'premium required' }, { status: 403 });
  }

  const today = getCurrentDayNumber();
  const dayNumber = Math.min(requested, today);

  const rows = await getDailyLeaderboard(dayNumber, 100);
  // [debug] chasing the prod-returns-fewer-rows-than-DB bug (PR #93).
  // Remove after root cause is identified.
  console.log('[leaderboard]', {
    dayNumber,
    rowCount: rows.length,
    playerKeys: rows.map((r) => r.playerKey),
  });
  return NextResponse.json({ dayNumber, entries: rows });
}
