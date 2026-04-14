import Link from 'next/link';
import { getArchiveList } from '@/lib/db/queries';

/**
 * Past puzzles index. Public route — premium gating for access lives
 * on the home-page tile click, so a user who shares an /archive link
 * or lands here directly isn't silently redirected. The individual
 * per-day leaderboard pages remain open already, so there's no new
 * data exposure here vs. what /leaderboard/[day] already ships.
 */
export const dynamic = 'force-dynamic';

export default async function ArchivePage() {
  const entries = await getArchiveList(60);

  return (
    <main className="flex-1 flex flex-col items-center px-4 pt-10 pb-6 gap-6 max-w-2xl mx-auto w-full">
      <header className="text-center">
        <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-gray-900">
          Archive
        </h1>
        <p className="text-sm font-medium text-gray-500 mt-1">
          Past puzzles — tap a day to see its leaderboard.
        </p>
      </header>

      {entries.length === 0 ? (
        <p className="text-sm text-gray-500 mt-6">No past puzzles yet.</p>
      ) : (
        <ul className="w-full divide-y divide-gray-100 rounded-card bg-white shadow-card overflow-hidden">
          {entries.map((e) => (
            <li key={e.dayNumber}>
              <Link
                href={`/leaderboard/${e.dayNumber}`}
                className="flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors duration-fast"
              >
                <span className="text-sm font-bold text-gray-900 tabular-nums">
                  #{e.dayNumber.toString().padStart(3, '0')}
                </span>
                <span className="text-xs font-medium text-gray-500 tabular-nums">
                  {e.date}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Link
        href="/"
        className="text-sm font-medium text-brand hover:text-brand-700 transition-colors duration-fast mt-4"
      >
        ← Back to today’s puzzle
      </Link>
    </main>
  );
}
