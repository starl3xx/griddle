'use client';

import { useEffect, useState } from 'react';
import { formatMs } from '@/lib/format';

interface GameTimerProps {
  /** Epoch ms when the Start button was pressed. */
  startedAt: number;
  /**
   * Authoritative solve duration (server-computed ms). When non-null,
   * the timer displays this fixed value and stops the 1 s interval —
   * a single source of truth for the frozen state that survives the
   * component remount caused by toggling the solve modal closed.
   */
  frozenMs?: number | null;
}

/**
 * Solve timer pill — small, neutral, sits in the header row alongside
 * the Griddle wordmark. Intentionally quiet so the player's attention
 * stays on the grid, not the clock. Ticks once per second while
 * `frozenMs` is null; otherwise displays that fixed value and clears
 * the interval so a modal-close remount can't inflate the display by
 * picking up a fresh `Date.now()` against the original startedAt.
 */
export function GameTimer({ startedAt, frozenMs }: GameTimerProps) {
  const frozen = frozenMs != null;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (frozen) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [frozen]);

  const displayMs = frozen
    ? Math.max(0, frozenMs as number)
    : Math.max(0, now - startedAt);

  return (
    <div
      className="inline-flex items-center rounded-pill bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-1 text-sm font-semibold tabular-nums"
      aria-live="off"
    >
      {formatMs(displayMs)}
    </div>
  );
}
