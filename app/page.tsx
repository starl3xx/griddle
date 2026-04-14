import { notFound } from 'next/navigation';
import GameClient from './GameClient';
import { getTodayPuzzle, recordPuzzleLoad } from '@/lib/db/queries';
import { getSessionId } from '@/lib/session';

/**
 * Root page. Server component — reads today’s puzzle directly from
 * Neon via Drizzle (the **target word is stripped from the payload**
 * before it leaves the server) and passes the safe subset into the
 * client-side game wrapper.
 *
 * Session handling is owned by `middleware.ts`, which mints a session
 * cookie on first visit and forwards the id via the `x-session-id`
 * request header so this handler can read it synchronously.
 *
 * This route is `force-dynamic` because the puzzle rolls over at UTC
 * midnight and the session cookie is set per-request.
 */
export const dynamic = 'force-dynamic';

export default async function Page() {
  const sessionId = await getSessionId();

  const puzzle = await getTodayPuzzle();
  if (!puzzle) {
    notFound();
  }

  // Record the first load — authoritative start time for server_solve_ms.
  // Idempotent, safe to call on every render; later loads are no-ops.
  await recordPuzzleLoad(sessionId, puzzle.id);

  // Explicit prop shape — intentionally does NOT include `puzzle.word`.
  // Don’t be tempted to spread `puzzle` here; the spread would leak the
  // answer to the client bundle.
  return (
    <GameClient
      initialPuzzle={{
        dayNumber: puzzle.dayNumber,
        date: puzzle.date,
        grid: puzzle.grid,
      }}
    />
  );
}
