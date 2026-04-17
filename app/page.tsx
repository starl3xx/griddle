import { notFound } from 'next/navigation';
import GameClient from './GameClient';
import {
  getCrumbsForSession,
  getPreviousSolveMsForPuzzle,
  getPuzzleStartedAt,
  getTodayPuzzle,
  getUserSettings,
  recordPuzzleLoad,
} from '@/lib/db/queries';
import { getSessionId } from '@/lib/session';
import { getSessionProfile } from '@/lib/session-profile';
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
  // profileId from session KV so we can detect a prior solve against
  // the handle-only identity path.
  const [puzzle, sessionWallet, profileId] = await Promise.all([
    getTodayPuzzle(),
    getSessionWallet(sessionId),
    getSessionProfile(sessionId),
  ]);
  if (!puzzle) {
    notFound();
  }

  // Read started_at + any prior solve + persisted crumbs in parallel
  // with recordPuzzleLoad + settings. No ordering constraint: on a
  // first visit no rows exist and all return null/empty; on return
  // visits the rows are already there (onConflictDoNothing no-op).
  // Prior-solve detection matches on profile_id OR wallet OR
  // session_id, so anonymous refreshes still hydrate the post-solve
  // UI state. Crumbs are keyed on session_id today (same semantics
  // as /api/crumbs) so the SSR fetch and the client fetch return
  // identical data — the refresh lane in GameClient becomes a no-op
  // dedup instead of the sole source of truth.
  const [settings, initialStartedAt, previousSolveMs, initialCrumbs] = await Promise.all([
    sessionWallet ? getUserSettings(sessionWallet) : Promise.resolve(null),
    getPuzzleStartedAt(sessionId, puzzle.dayNumber),
    getPreviousSolveMsForPuzzle(
      { sessionId, wallet: sessionWallet, profileId },
      puzzle.id,
    ),
    getCrumbsForSession(sessionId, puzzle.id),
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
      initialStartedAt={initialStartedAt != null ? initialStartedAt.toISOString() : null}
      initialFinalSolveMs={previousSolveMs}
      initialCrumbs={initialCrumbs}
    />
  );
}
