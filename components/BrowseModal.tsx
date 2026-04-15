'use client';

import { useEffect, useState } from 'react';
import { ChartBar, Trophy, Archive } from '@phosphor-icons/react';
import { StatsPanel } from './panels/StatsPanel';
import { LeaderboardPanel } from './panels/LeaderboardPanel';
import { ArchivePanel } from './panels/ArchivePanel';

export type BrowseTab = 'stats' | 'leaderboard' | 'archive';

interface BrowseModalProps {
  /** The active tab, or null to close the modal. */
  openTab: BrowseTab | null;
  /** Whichever tab the user taps, set this from the parent. */
  onTabChange: (tab: BrowseTab) => void;
  onClose: () => void;

  /** Passed through to StatsPanel — see its props for details. */
  premium: boolean;
  hasSessionProfile: boolean;
  pfpUrl: string | null;
  displayName: string | null;
  onCreateProfile: () => void;
  onUpgrade: () => void;

  /** Today's day number — default view for the leaderboard tab. */
  todayDayNumber: number;
}

/**
 * Single shell hosting Stats / Leaderboard / Archive as tabs at the
 * bottom of the modal (iOS-style). Whichever HomeTile the user tapped
 * determines the initial tab; they can switch freely without closing.
 *
 * Mount model: the modal stays mounted for the whole open session, but
 * each panel only fetches its data when it's the active tab. This means
 * switching back to a tab refetches — fine for the current scale, can
 * add tab-level caching later if it becomes a UX concern.
 *
 * Replaces: the old standalone StatsModal (deleted in this PR) plus
 * page navigations to /leaderboard/[day] and /archive from the tile
 * row. The two standalone pages still exist and still render — they're
 * the deep-link targets for shared leaderboard URLs, and the SolveModal
 * still links to /leaderboard/[day] for post-solve navigation.
 */
export function BrowseModal({
  openTab,
  onTabChange,
  onClose,
  premium,
  hasSessionProfile,
  pfpUrl,
  displayName,
  onCreateProfile,
  onUpgrade,
  todayDayNumber,
}: BrowseModalProps) {
  // The leaderboard panel lets the user scroll through past days. The
  // active day is kept in modal-level state so switching tabs and
  // coming back preserves the selection within one open session.
  const [leaderboardDay, setLeaderboardDay] = useState(todayDayNumber);

  // Reset leaderboard day to today whenever the modal is (re)opened.
  // Without this, opening the modal a second time would restore a
  // stale day from the previous session — surprising for a modal that
  // defaults to "today's leaderboard."
  useEffect(() => {
    if (openTab !== null) setLeaderboardDay(todayDayNumber);
  }, [openTab, todayDayNumber]);

  if (openTab === null) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="modal-sheet animate-slide-up flex flex-col p-0 overflow-hidden"
        style={{ height: 'min(640px, 92vh)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Content area — scrolls vertically, padded. The tab bar at
            the bottom is outside this div and never scrolls. */}
        <div className="flex-1 overflow-y-auto p-6">
          {openTab === 'stats' && (
            <StatsPanel
              premium={premium}
              hasSessionProfile={hasSessionProfile}
              pfpUrl={pfpUrl}
              displayName={displayName}
              onCreateProfile={onCreateProfile}
              onUpgrade={onUpgrade}
              onClose={onClose}
            />
          )}
          {openTab === 'leaderboard' && (
            <LeaderboardPanel
              dayNumber={leaderboardDay}
              todayDayNumber={todayDayNumber}
              onDayChange={setLeaderboardDay}
              onClose={onClose}
            />
          )}
          {openTab === 'archive' && (
            <ArchivePanel
              onDayPick={(d) => {
                setLeaderboardDay(d);
                onTabChange('leaderboard');
              }}
              onClose={onClose}
            />
          )}
        </div>

        {/* Bottom tab bar — iOS-style. Three equal columns, icon over
            label, brand color on the active tab, gray on the others,
            2px top border running the full width. */}
        <nav
          className="grid grid-cols-3 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
          role="tablist"
          aria-label="Browse"
        >
          <TabButton
            active={openTab === 'stats'}
            label="Stats"
            icon={<ChartBar className="w-5 h-5" weight="bold" aria-hidden />}
            onClick={() => onTabChange('stats')}
          />
          <TabButton
            active={openTab === 'leaderboard'}
            label="Leaderboard"
            icon={<Trophy className="w-5 h-5" weight="bold" aria-hidden />}
            onClick={() => onTabChange('leaderboard')}
          />
          <TabButton
            active={openTab === 'archive'}
            label="Archive"
            icon={<Archive className="w-5 h-5" weight="bold" aria-hidden />}
            onClick={() => onTabChange('archive')}
          />
        </nav>
      </div>
    </div>
  );
}

function TabButton({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-1 py-3 transition-colors duration-fast focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand ${
        active
          ? 'text-brand dark:text-brand-300'
          : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
      }`}
    >
      {icon}
      <span className="text-[10px] font-bold uppercase tracking-wider">
        {label}
      </span>
    </button>
  );
}
