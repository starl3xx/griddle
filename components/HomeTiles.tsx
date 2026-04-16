'use client';

import { Trophy, Archive, ChartBar } from '@phosphor-icons/react';
import type { BrowseTab } from './BrowseModal';

interface HomeTilesProps {
  /** Called with the requested tab name — always opens BrowseModal. */
  onTileClick: (tab: BrowseTab) => void;
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
export function HomeTiles({ onTileClick }: HomeTilesProps) {
  return (
    <div className="w-full max-w-[420px] grid grid-cols-3 gap-3">
      <Tile label="Stats" onClick={() => onTileClick('stats')}>
        <ChartBar className="w-5 h-5 text-accent" weight="bold" aria-hidden />
      </Tile>
      <Tile label="Leaderboard" onClick={() => onTileClick('leaderboard')}>
        <Trophy className="w-5 h-5 text-accent" weight="bold" aria-hidden />
      </Tile>
      <Tile label="Archive" onClick={() => onTileClick('archive')}>
        <Archive className="w-5 h-5 text-accent" weight="bold" aria-hidden />
      </Tile>
    </div>
  );
}

interface TileProps {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}

function Tile({ label, onClick, children }: TileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="bg-white dark:bg-gray-800 hover:bg-brand-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 hover:border-brand-200 dark:hover:border-brand-600 rounded-card px-3 py-3 flex flex-col items-center justify-center gap-1.5 shadow-card transition-colors duration-fast focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      {children}
      <span className="text-[11px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
        {label}
      </span>
    </button>
  );
}

