'use client';

import { useEffect, useState } from 'react';
import type { CellState } from '@/lib/useGriddle';

interface GridProps {
  grid: string;
  cellStates: CellState[];
  sequenceByCell: Array<number | null>;
  shakeSignal: number;
  solved: boolean;
  onCellTap: (idx: number) => void;
}

export function Grid({ grid, cellStates, sequenceByCell, shakeSignal, solved, onCellTap }: GridProps) {
  const [shaking, setShaking] = useState(false);

  useEffect(() => {
    if (shakeSignal === 0) return;
    setShaking(true);
    const t = setTimeout(() => setShaking(false), 420);
    return () => clearTimeout(t);
  }, [shakeSignal]);

  return (
    <div
      className={[
        'grid grid-cols-3 gap-2 p-2 rounded-card',
        shaking ? 'animate-shake' : '',
        solved ? 'animate-pulse-glow rounded-card' : '',
      ].join(' ')}
    >
      {Array.from({ length: 9 }, (_, i) => (
        <Cell
          key={i}
          letter={grid[i]}
          state={cellStates[i]}
          sequence={sequenceByCell[i]}
          onClick={() => onCellTap(i)}
        />
      ))}
    </div>
  );
}

interface CellProps {
  letter: string;
  state: CellState;
  sequence: number | null;
  onClick: () => void;
}

function Cell({ letter, state, sequence, onClick }: CellProps) {
  const base =
    'relative w-20 h-20 sm:w-24 sm:h-24 rounded-lg border-4 flex items-center justify-center text-3xl sm:text-4xl font-black uppercase transition-all duration-fast select-none';
  /**
   * Visual semantics: dark + white text means "this letter is consumed
   * (in use or already used)", light + dark text means "this letter is
   * still in play (available or temporarily off-limits)".
   *
   * Sub-distinctions inside each category:
   *   current (consumed) — scale-105 + shadow-card so it visually pops
   *                        as the focused / most-recent cell
   *   used    (consumed) — no scale, smaller shadow, sequence number
   *                        in the corner showing the typing order
   *   available (in play) — pale green tint signals "go"
   *   open    (in play)  — neutral white before any letter is typed
   *   blocked (in play)  — pale gray, muted text, no X overlay so the
   *                        letter remains readable for planning ahead
   */
  const stateClasses: Record<CellState, string> = {
    open: 'bg-white border-gray-300 text-gray-900 hover:border-brand shadow-btn',
    available: 'bg-success-50 border-success-200 text-gray-900 hover:border-success-500 shadow-btn',
    // current = vivid mid blue, scaled up + heavier shadow so it’s the
    // visual focus of the grid. used = deep navy so previously-typed
    // letters read as "settled" / "older" but still clearly consumed.
    current: 'bg-brand border-brand text-white scale-105 shadow-card',
    used: 'bg-brand-800 border-brand-800 text-white shadow-btn',
    blocked: 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed',
  };
  const disabled = state === 'blocked';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${stateClasses[state]}`}
      aria-label={`Letter ${letter}, ${state}`}
    >
      <span>{letter.toUpperCase()}</span>
      {state === 'used' && sequence !== null && (
        <span className="absolute top-1 right-1.5 text-[10px] font-semibold text-white/70 tabular-nums">
          {sequence}
        </span>
      )}
    </button>
  );
}
