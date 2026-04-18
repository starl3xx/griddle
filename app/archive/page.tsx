import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getArchiveList } from '@/lib/db/queries';
import { getSessionId } from '@/lib/session';
import { isSessionPremium } from '@/lib/premium-check';

/**
 * Past puzzles index. Premium-gated at the page level: non-premium
 * visitors redirect to `/`, matching the /leaderboard/[day] gate. The
 * home-page tile remains the single upsell surface.
 */
export const dynamic = 'force-dynamic';

export default async function ArchivePage() {
  const sessionId = await getSessionId();
  const premium = await isSessionPremium(sessionId);
  if (!premium) redirect('/');

  const entries = await getArchiveList(60);

  return (
    <main className="flex-1 flex flex-col items-center px-4 pt-10 pb-6 gap-6 max-w-2xl mx-auto w-full">
      <header className="text-center">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-gray-900">
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
