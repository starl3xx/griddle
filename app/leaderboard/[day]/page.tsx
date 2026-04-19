import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Crown } from '@phosphor-icons/react/dist/ssr';
import { getDailyLeaderboard } from '@/lib/db/queries';
import { getCurrentDayNumber } from '@/lib/scheduler';
import { formatMs, formatPlayerName } from '@/lib/format';
import { Avatar } from '@/components/Avatar';
import { WordmarkBadges } from '@/components/WordmarkBadges';
import { getSessionId } from '@/lib/session';
import { isSessionPremium } from '@/lib/premium-check';

/**
 * Daily leaderboard page. Server component — fetches directly via
 * Drizzle, no client-side data fetching needed.
 *
 * Premium-gated at the page level: non-premium visitors redirect to
 * `/`, where the Leaderboard tile surfaces the upgrade CTA. Prior
 * behavior left this route public, which leaked ranked times to anyone
 * with a direct link and undercut the in-app panel's premium gate.
 *
 * Day param is clamped to today so future puzzles aren't reachable.
 */
export const dynamic = 'force-dynamic';

export default async function LeaderboardPage({
  params,
}: {
  params: Promise<{ day: string }>;
}) {
  const { day } = await params;
  const requested = parseInt(day, 10);
  if (!Number.isFinite(requested) || requested < 1) notFound();

  const sessionId = await getSessionId();
  const premium = await isSessionPremium(sessionId);
  if (!premium) redirect('/');

  const today = getCurrentDayNumber();
  const dayNumber = Math.min(requested, today);
  const entries = await getDailyLeaderboard(dayNumber, 100);

  return (
    <main className="flex-1 flex flex-col items-center px-4 pt-10 pb-12 gap-6">
      <header className="text-center">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-gray-900">
          Leaderboard
        </h1>
        <p className="text-sm font-medium text-gray-500 mt-1 tabular-nums">
          Griddle #{dayNumber.toString().padStart(3, '0')}
        </p>
      </header>

      <div className="w-full max-w-md">
        {entries.length === 0 ? (
          <p className="text-center text-gray-500 text-sm">
            No legitimate solves yet. Be the first.
          </p>
        ) : (
          <ol className="flex flex-col gap-1.5">
            {entries.map((e) => (
              <li
                key={e.playerKey}
                className="flex items-center gap-2 px-3 py-2"
              >
                <span className="text-xs font-bold text-gray-400 tabular-nums w-8">
                  #{e.rank}
                </span>
                <Avatar pfpUrl={e.avatarUrl} seed={e.handle ?? e.playerKey} size="xs" />
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  <span
                    className={`text-sm truncate ${
                      e.handle ? 'font-semibold text-gray-900' : 'font-mono text-gray-700'
                    }`}
                  >
                    {formatPlayerName(e)}
                  </span>
                  <WordmarkBadges ids={e.topWordmarks} />
                </div>
                {e.unassisted && (
                  <span
                    className="text-accent inline-flex items-center"
                    title="Unassisted solve"
                    aria-label="unassisted"
                  >
                    <Crown className="w-3.5 h-3.5" weight="fill" aria-hidden />
                  </span>
                )}
                <span className="text-sm font-bold text-gray-900 tabular-nums">
                  {formatMs(e.serverSolveMs)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <Link href="/" className="text-sm text-gray-500 hover:text-brand transition-colors">
        ← back to today’s puzzle
      </Link>
    </main>
  );
}

