import { NextResponse } from 'next/server';
import { getArchiveList, getMySolvedDayNumbers } from '@/lib/db/queries';
import { getCurrentDayNumber, getDateForDayNumber } from '@/lib/scheduler';
import { getSessionId } from '@/lib/session';
import { getSessionWallet } from '@/lib/wallet-session';
import { getSessionProfile } from '@/lib/session-profile';

/**
 * GET /api/archive
 *
 * Returns the list of past puzzle days (newest first, excluding today)
 * for the Archive tab inside BrowseModal. The server component at
 * `/archive/page.tsx` calls `getArchiveList()` directly for deep-linked
 * SSR; this JSON endpoint is the client-side counterpart used from the
 * modal.
 *
 * Also returns:
 *   - `solvedDayNumbers` — the caller's own completed days (resolved
 *     via session → profile / wallet / session-id) so the calendar can
 *     mark their solves in-line without a second round-trip.
 *   - `todayDayNumber` — lets the client distinguish "today" visually
 *     without re-computing UTC midnight client-side.
 *
 * Premium gating is handled client-side — the tile that opens the
 * Archive tab is already Premium-gated, so we don't re-enforce here.
 * Anyone who knows the URL can fetch it, mirroring the `/archive`
 * page's public access.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const sessionId = await getSessionId();
  const [entries, wallet, profileId] = await Promise.all([
    getArchiveList(60),
    getSessionWallet(sessionId),
    getSessionProfile(sessionId),
  ]);
  const solvedDayNumbers = await getMySolvedDayNumbers({
    profileId,
    wallet,
    sessionId,
  });
  const todayDayNumber = getCurrentDayNumber();
  const todayDate = getDateForDayNumber(todayDayNumber);
  return NextResponse.json({
    entries,
    solvedDayNumbers,
    todayDayNumber,
    todayDate,
  });
}
