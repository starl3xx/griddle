'use client';

import { Trophy, Archive, Diamond, ChartBar } from '@phosphor-icons/react';

interface HomeTilesProps {
  onStatsClick: () => void;
  onLeaderboardClick: () => void;
  onArchiveClick: () => void;
  /** True when the user has premium unlocked — drives the lock badge on gated tiles. */
  premium: boolean;
}

/**
 * Three-tile action row below the Backspace/Reset controls. Tapping a
 * tile dispatches its handler — the parent owns the modal state and the
 * premium-gate decision so unit-level premium logic doesn't leak into
 * this component. Tiles share a single visual rhythm (square icon,
 * label, optional lock badge) so the row reads as one unit at a glance.
 *
 * Stats tile uses a bar-chart icon (not an avatar) — profile identity
 * lives in the top-right Settings button; this row is purely about
 * jumping into data surfaces (your own stats, the ranked leaderboard,
 * the puzzle archive).
 */
export function HomeTiles({
  onStatsClick,
  onLeaderboardClick,
  onArchiveClick,
  premium,
}: HomeTilesProps) {
  return (
    <div className="w-full max-w-[420px] grid grid-cols-3 gap-3">
      <Tile label="Stats" onClick={onStatsClick}>
        <ChartBar className="w-5 h-5 text-accent" weight="bold" aria-hidden />
      </Tile>
      <Tile label="Leaderboard" onClick={onLeaderboardClick} locked={!premium}>
        <Trophy className="w-5 h-5 text-accent" weight="bold" aria-hidden />
      </Tile>
      <Tile label="Archive" onClick={onArchiveClick} locked={!premium}>
        <Archive className="w-5 h-5 text-accent" weight="bold" aria-hidden />
      </Tile>
    </div>
  );
}

interface TileProps {
  label: string;
  onClick: () => void;
  locked?: boolean;
  children: React.ReactNode;
}

function Tile({ label, onClick, locked = false, children }: TileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative bg-white dark:bg-gray-800 hover:bg-brand-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 hover:border-brand-200 dark:hover:border-brand-600 rounded-card px-3 py-3 flex flex-col items-center justify-center gap-1.5 shadow-card transition-colors duration-fast focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      {children}
      <span className="text-[11px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
        {label}
      </span>
      {locked && (
        <span
          className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-accent/15 text-accent flex items-center justify-center"
          aria-label="Premium"
          title="Premium"
        >
          <Diamond className="w-2.5 h-2.5" weight="fill" aria-hidden />
        </span>
      )}
    </button>
  );
}

