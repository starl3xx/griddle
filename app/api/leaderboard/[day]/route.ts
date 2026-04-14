import { NextResponse } from 'next/server';
import { getDailyLeaderboard } from '@/lib/db/queries';
import { getCurrentDayNumber } from '@/lib/scheduler';

/**
 * GET /api/leaderboard/[day]
 *
 * Returns the top 100 wallet-attributed solves for a given puzzle day,
 * fastest first. Each wallet appears once (their best time).
 *
 * Filters: solved + non-anonymous + flag-clean. Suspicious/ineligible
 * solves are excluded; the leaderboard is the curated list of legit
 * human solves.
 *
 * Past puzzles are accessible (premium archive). Future puzzles are
 * clamped to today to prevent leaderboard-poking attacks before the
 * puzzle is live.
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

  const today = getCurrentDayNumber();
  const dayNumber = Math.min(requested, today);

  const rows = await getDailyLeaderboard(dayNumber, 100);
  return NextResponse.json({ dayNumber, entries: rows });
}
