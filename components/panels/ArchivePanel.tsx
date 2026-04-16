'use client';

import { useEffect, useState } from 'react';
import { CircleNotch, Diamond } from '@phosphor-icons/react';

interface ArchiveEntry {
  dayNumber: number;
  date: string;
}

interface ArchivePanelProps {
  /** True when the user has Premium — shows the archive list. */
  premium: boolean;
  /** Opens the Premium upgrade flow. */
  onUpgrade: () => void;
  /**
   * Called when the user taps a day. BrowseModal uses this to switch
   * to the Leaderboard tab showing that specific day, so exploring
   * the archive hands off to the leaderboard view without a page nav.
   */
  onDayPick: (dayNumber: number) => void;
  onClose: () => void;
}

/**
 * Past-puzzles index for BrowseModal's Archive tab. Client-fetches
 * `/api/archive` on mount. Tapping a row switches the modal to the
 * Leaderboard tab pinned to that day — so the full archive → leader-
 * board exploration loop lives inside one modal, no page nav.
 *
 * The standalone `/archive` page still exists for deep-linking and
 * SSR (same data, same fetch helper), but the in-app path from the
 * HomeTiles row now goes through this panel.
 */
export function ArchivePanel({ premium, onUpgrade, onDayPick, onClose }: ArchivePanelProps) {
  const [entries, setEntries] = useState<ArchiveEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!premium) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch('/api/archive', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((j: { entries: ArchiveEntry[] }) => {
        if (!cancelled) {
          setEntries(j.entries);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [premium]);

  return (
    <>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold tracking-tight text-gray-900 dark:text-gray-100">
            Archive
          </h2>
          <p className="text-xs font-medium text-gray-500">
            Tap a day to see its leaderboard
          </p>
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

      <div className="mt-5">
        {!premium ? (
          <div className="py-8 text-center space-y-4">
            <Diamond className="w-8 h-8 text-accent mx-auto" weight="fill" aria-hidden />
            <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed max-w-xs mx-auto">
              Upgrade to Premium to replay every past puzzle from the full archive.
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
            Couldn’t load the archive. Try again.
          </p>
        ) : !entries || entries.length === 0 ? (
          <p className="text-center text-gray-500 text-sm py-8">
            No past puzzles yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {entries.map((e) => (
              <li key={e.dayNumber}>
                <button
                  type="button"
                  onClick={() => onDayPick(e.dayNumber)}
                  className="w-full flex items-center justify-between bg-white dark:bg-gray-700/40 hover:bg-brand-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 transition-colors duration-fast focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  <span className="text-sm font-bold text-gray-900 dark:text-gray-100 tabular-nums">
                    #{e.dayNumber.toString().padStart(3, '0')}
                  </span>
                  <span className="text-xs font-medium text-gray-500 tabular-nums">
                    {e.date}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
