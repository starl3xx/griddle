'use client';

import { useEffect, useRef, useState } from 'react';
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
  profileLoaded: boolean;
  pfpUrl: string | null;
  username: string | null;
  /**
   * Bound profile email, if any. Forwarded to StatsPanel so its
   * avatar fallback chain (handle → wallet → email) matches the gear
   * button — without it, an email-only user would render two
   * different monograms in the same session.
   */
  email: string | null;
  onCreateProfile: () => void;
  onUpgrade: () => void;

  /** Today's day number — default view for the leaderboard tab. */
  todayDayNumber: number;
  /**
   * Day to seed the leaderboard tab with on a closed→open transition.
   * When undefined, the tab opens on `todayDayNumber`. Set from the
   * post-solve nav so a player who solves an ARCHIVE puzzle lands on
   * the leaderboard for THAT puzzle instead of today's.
   */
  leaderboardInitialDay?: number;
  /** Loads an archive puzzle into the main game grid and closes the modal. */
  onLoadPuzzle: (dayNumber: number) => void;
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
  profileLoaded,
  pfpUrl,
  username,
  email,
  onCreateProfile,
  onUpgrade,
  todayDayNumber,
  leaderboardInitialDay,
  onLoadPuzzle,
}: BrowseModalProps) {
  // The leaderboard panel lets the user scroll through past days. The
  // active day is kept in modal-level state so switching tabs and
  // coming back preserves the selection within one open session.
  const [leaderboardDay, setLeaderboardDay] = useState(
    leaderboardInitialDay ?? todayDayNumber,
  );

  // Reset leaderboard day on a closed → open transition. Defaults to
  // today, but the parent can override via `leaderboardInitialDay` so
  // a post-archive-solve hand-off lands on the leaderboard for the
  // puzzle that was just solved (not today's).
  //
  // Gating on `openTab !== null` directly in the effect would fire
  // every tab switch (each changes `openTab`), which would overwrite
  // a day just selected by the archive → leaderboard hand-off:
  // `onDayPick(d)` sets the day and THEN flips the tab, and a naive
  // `openTab`-dep effect would immediately clobber `d` back to today.
  // Tracking the previous open state with a ref isolates the transition.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    const isOpen = openTab !== null;
    if (isOpen && !wasOpenRef.current) {
      setLeaderboardDay(leaderboardInitialDay ?? todayDayNumber);
    }
    wasOpenRef.current = isOpen;
  }, [openTab, todayDayNumber, leaderboardInitialDay]);

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
              profileLoaded={profileLoaded}
              pfpUrl={pfpUrl}
              username={username}
              email={email}
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
              premium={premium}
              onUpgrade={onUpgrade}
              onClose={onClose}
            />
          )}
          {openTab === 'archive' && (
            <ArchivePanel
              premium={premium}
              onUpgrade={onUpgrade}
              onDayPick={(d) => {
                onLoadPuzzle(d);
                onClose();
              }}
              onClose={onClose}
            />
          )}
        </div>

        {/* Bottom tab bar — iOS-style. Three equal columns, icon over
            label, brand color on the active tab, gray on the others,
            2px top border running the full width. All three tabs are
            always accessible; non-premium users see an upgrade CTA
            inside the Leaderboard/Archive panel body. */}
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
