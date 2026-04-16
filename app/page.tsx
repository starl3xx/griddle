import { notFound } from 'next/navigation';
import GameClient from './GameClient';
import { getTodayPuzzle, getUserSettings, recordPuzzleLoad } from '@/lib/db/queries';
import { getSessionId } from '@/lib/session';
import { getSessionWallet } from '@/lib/wallet-session';

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
 *
 * We also hydrate the session wallet (from KV) and the user's
 * `unassistedModeEnabled` setting (from DB) here. Previously these
 * loaded asynchronously on the client after mount, producing a race
 * where the player could start solving with the default (assisted) UI
 * before their setting had propagated. By the time they finished, the
 * client had the correct `unassisted=true` and sent it with the solve
 * — so the server awarded Nightclub/Dauntless correctly per their
 * setting, but the UI during play didn't match. Server-hydration
 * eliminates the race for the common reload/session-resume path.
 */
export const dynamic = 'force-dynamic';

export default async function Page() {
  const sessionId = await getSessionId();

  // Kick off the three parallel reads. Wallet → KV (Upstash), puzzle
  // → Neon. Settings depends on wallet so it can't start until after.
  const [puzzle, sessionWallet] = await Promise.all([
    getTodayPuzzle(),
    getSessionWallet(sessionId),
  ]);
  if (!puzzle) {
    notFound();
  }

  const [settings] = await Promise.all([
    sessionWallet ? getUserSettings(sessionWallet) : Promise.resolve(null),
    recordPuzzleLoad(sessionId, puzzle.id),
  ]);

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
      initialSessionWallet={sessionWallet}
      initialUnassistedMode={settings?.unassistedModeEnabled ?? false}
    />
  );
}
