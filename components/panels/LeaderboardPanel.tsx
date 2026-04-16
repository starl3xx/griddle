'use client';

import { useEffect, useState } from 'react';
import { Diamond, CaretLeft, CaretRight, CircleNotch } from '@phosphor-icons/react';
import { formatMs, formatPlayerName } from '@/lib/format';
import { Avatar } from '../Avatar';

interface LeaderboardEntry {
  rank: number;
  playerKey: string;
  handle: string | null;
  wallet: string | null;
  avatarUrl: string | null;
  serverSolveMs: number;
  unassisted: boolean;
}

interface LeaderboardResponse {
  dayNumber: number;
  entries: LeaderboardEntry[];
}

interface LeaderboardPanelProps {
  /** Which day is currently displayed. */
  dayNumber: number;
  /** Today's day number — caps the "next" day button. */
  todayDayNumber: number;
  /** Lets the panel move forward/backward through days. */
  onDayChange: (day: number) => void;
  /** True when the user has Premium — shows full leaderboard. */
  premium: boolean;
  /** Opens the Premium upgrade flow. */
  onUpgrade: () => void;
  onClose: () => void;
}

/**
 * Daily leaderboard content for BrowseModal's Leaderboard tab.
 *
 * Fetches /api/leaderboard/[day] on mount and whenever `dayNumber`
 * changes. Lets the user step backward into past days with a prev
 * arrow — forward stops at today. This is essentially the standalone
 * /leaderboard/[day] page minus the outer <main> chrome, adapted for
 * client-side data fetching.
 *
 * Keeping the standalone page alive matters for share targets and
 * deep links — /leaderboard/42 remains a valid URL — but the default
 * in-app path now goes through the modal tab for continuity with
 * Stats and Archive.
 */
export function LeaderboardPanel({
  dayNumber,
  todayDayNumber,
  onDayChange,
  premium,
  onUpgrade,
  onClose,
}: LeaderboardPanelProps) {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!premium) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/leaderboard/${dayNumber}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((j: LeaderboardResponse) => {
        if (!cancelled) {
          setData(j);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [dayNumber, premium]);

  const canGoPrev = dayNumber > 1;
  const canGoNext = dayNumber < todayDayNumber;

  return (
    <>
      {/* Header with day stepper */}
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold tracking-tight text-gray-900 dark:text-gray-100">
            Leaderboard
          </h2>
          <p className="text-xs font-medium text-gray-500 tabular-nums">
            Griddle #{dayNumber.toString().padStart(3, '0')}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onDayChange(dayNumber - 1)}
            disabled={!canGoPrev}
            aria-label="Previous day"
            className="w-8 h-8 flex items-center justify-center text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-fast"
          >
            <CaretLeft className="w-4 h-4" weight="bold" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => onDayChange(dayNumber + 1)}
            disabled={!canGoNext}
            aria-label="Next day"
            className="w-8 h-8 flex items-center justify-center text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-fast"
          >
            <CaretRight className="w-4 h-4" weight="bold" aria-hidden />
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors duration-fast"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="w-4 h-4" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="mt-5">
        {!premium ? (
          <div className="py-8 text-center space-y-4">
            <Diamond className="w-8 h-8 text-accent mx-auto" weight="fill" aria-hidden />
            <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed max-w-xs mx-auto">
              Upgrade to Premium to see each day's ranked leaderboard and how you stack up.
            </p>
            <button type="button" onClick={onUpgrade} className="btn-primary">
              Upgrade to Premium
            </button>
          </div>
        ) : loading ? (
          <div className="flex justify-center py-10">
            <CircleNotch className="w-6 h-6 text-gray-400 animate-spin" weight="bold" aria-hidden />
          </div>
        ) : error ? (
          <p className="text-center text-sm text-red-600 dark:text-red-400 py-8">
            Couldn’t load this leaderboard. Try again.
          </p>
        ) : !data || data.entries.length === 0 ? (
          <p className="text-center text-gray-500 text-sm py-8">
            No legitimate solves yet. Be the first.
          </p>
        ) : (
          <ol className="flex flex-col gap-1.5">
            {data.entries.map((e) => (
              <li
                key={e.playerKey}
                className="flex items-center gap-2 bg-white dark:bg-gray-700/40 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2"
              >
                <span className="text-xs font-bold text-gray-400 tabular-nums w-8">
                  #{e.rank}
                </span>
                <Avatar pfpUrl={e.avatarUrl} size="xs" />
                <span
                  className={`flex-1 text-sm truncate ${
                    e.handle
                      ? 'font-semibold text-gray-900 dark:text-gray-100'
                      : 'font-mono text-gray-700 dark:text-gray-300'
                  }`}
                >
                  {formatPlayerName(e)}
                </span>
                {e.unassisted && (
                  <span
                    className="text-accent inline-flex items-center"
                    title="Unassisted solve"
                    aria-label="unassisted"
                  >
                    <Diamond className="w-3.5 h-3.5" weight="fill" aria-hidden />
                  </span>
                )}
                <span className="text-sm font-bold text-gray-900 dark:text-gray-100 tabular-nums">
                  {formatMs(e.serverSolveMs)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </>
  );
}

