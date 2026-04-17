import { NextResponse } from 'next/server';
import { getSessionId } from '@/lib/session';
import { getSessionWallet } from '@/lib/wallet-session';
import { getCrumbsForSession, saveCrumb, getPuzzleByDay } from '@/lib/db/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/crumbs?dayNumber=123
 *
 * Returns all crumbs the current session has found on the given puzzle,
 * sorted oldest-first. Used by GameClient to restore found words on
 * page reload or return visit.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const dayStr = searchParams.get('dayNumber');
  if (!dayStr) {
    return NextResponse.json({ error: 'dayNumber is required' }, { status: 400 });
  }
  const dayNumber = parseInt(dayStr, 10);
  if (isNaN(dayNumber) || dayNumber < 0) {
    return NextResponse.json({ error: 'invalid dayNumber' }, { status: 400 });
  }

  const sessionId = await getSessionId();
  const puzzle = await getPuzzleByDay(dayNumber);
  if (!puzzle) {
    return NextResponse.json({ crumbs: [] });
  }

  // Passing wallet widens the crumb match from "this session only"
  // to "this session OR any session that ever saved a crumb with
  // this wallet" — resilient to session rotation (PWA vs browser,
  // cookie eviction, etc.) without re-requiring the user to find
  // their crumbs again.
  const wallet = await getSessionWallet(sessionId);
  const crumbs = await getCrumbsForSession(sessionId, puzzle.id, wallet);
  return NextResponse.json({ crumbs });
}

/**
 * POST /api/crumbs  { dayNumber, word }
 *
 * Persists a newly discovered crumb. Idempotent — posting the same
 * word twice for the same puzzle is a silent no-op.
 */
export async function POST(req: Request): Promise<NextResponse> {
  let body: { dayNumber?: number; word?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const { dayNumber, word } = body;
  if (typeof dayNumber !== 'number' || dayNumber < 0) {
    return NextResponse.json({ error: 'dayNumber is required' }, { status: 400 });
  }
  if (typeof word !== 'string' || word.length < 4 || word.length > 8 || !/^[a-zA-Z]+$/.test(word)) {
    return NextResponse.json({ error: 'word must be 4–8 alpha characters' }, { status: 400 });
  }

  const sessionId = await getSessionId();
  const puzzle = await getPuzzleByDay(dayNumber);
  if (!puzzle) {
    return NextResponse.json({ error: 'unknown puzzle' }, { status: 404 });
  }

  const wallet = await getSessionWallet(sessionId);
  const isNew = await saveCrumb(sessionId, puzzle.id, word, wallet);

  return NextResponse.json({ saved: isNew });
}
