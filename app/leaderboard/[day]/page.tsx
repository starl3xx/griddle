import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDailyLeaderboard } from '@/lib/db/queries';
import { getCurrentDayNumber } from '@/lib/scheduler';
import { formatMs } from '@/lib/format';

/**
 * Daily leaderboard page. Server component — fetches directly via
 * Drizzle, no client-side data fetching needed.
 *
 * Day param is clamped to today so future puzzles aren't reachable.
 * Past days are fine (premium archive will gate them client-side
 * later, but the public route returns whatever's there).
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

  const today = getCurrentDayNumber();
  const dayNumber = Math.min(requested, today);
  const entries = await getDailyLeaderboard(dayNumber, 100);

  return (
    <main className="flex-1 flex flex-col items-center px-4 pt-10 pb-12 gap-6">
      <header className="text-center">
        <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-gray-900">
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
                key={e.wallet}
                className="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-3 py-2 shadow-btn"
              >
                <span className="text-xs font-bold text-gray-400 tabular-nums w-8">
                  #{e.rank}
                </span>
                <span className="flex-1 text-sm font-mono text-gray-700">
                  {e.wallet.slice(0, 6)}…{e.wallet.slice(-4)}
                </span>
                {e.unassisted && (
                  <span
                    className="text-accent text-sm font-bold mr-2"
                    title="Unassisted solve"
                    aria-label="unassisted"
                  >
                    ◆
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
