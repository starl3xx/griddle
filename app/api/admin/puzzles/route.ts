import { NextResponse } from 'next/server';
import { requireAdminWallet } from '@/lib/admin';
import {
  getTodaysPuzzleHealth,
  getUpcomingPuzzles,
  getPastPuzzles,
  getPuzzleDifficulty,
  getNeverSolvedPuzzles,
  getPuzzleCalibration,
} from '@/lib/db/queries';

/**
 * GET /api/admin/puzzles
 *
 * Admin Puzzles tab — content ops view. Bundles today's health card,
 * upcoming-10, hardest/easiest historical, never-solved list, and the
 * heuristic-vs-observed calibration data (scatter + OLS regression).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const admin = await requireAdminWallet();
  if (!admin) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const [today, upcoming, past, hardest, easiest, neverSolved, calibration] = await Promise.all([
    getTodaysPuzzleHealth(),
    getUpcomingPuzzles(10),
    getPastPuzzles(20),
    getPuzzleDifficulty({ order: 'hardest', limit: 20, minSolves: 10 }),
    getPuzzleDifficulty({ order: 'easiest', limit: 20, minSolves: 10 }),
    getNeverSolvedPuzzles(),
    getPuzzleCalibration(10),
  ]);

  return NextResponse.json({ today, upcoming, past, hardest, easiest, neverSolved, calibration });
}
