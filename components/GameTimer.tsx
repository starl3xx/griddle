'use client';

import { useEffect, useState } from 'react';
import { formatMs } from '@/lib/format';

interface GameTimerProps {
  /** Epoch ms when the Start button was pressed. */
  startedAt: number;
  /**
   * Authoritative solve duration (server-computed ms). When non-null,
   * the timer displays this fixed value instead of ticking. Single
   * source of truth for the frozen state that survives the component
   * remount caused by toggling the solve modal closed.
   */
  frozenMs?: number | null;
}

/**
 * Solve timer pill — small, neutral, sits in the header row alongside
 * the Griddle wordmark. Intentionally quiet so the player's attention
 * stays on the grid, not the clock.
 *
 * `displayMs` is computed from `Date.now()` at render time (not from
 * a `now` state value) so there's no stale-window class of bugs when
 * the component stays mounted across a frozen→ticking transition or
 * a startedAt change. The 1 s interval just triggers re-renders via
 * a dummy state bump; actual time read happens during render.
 */
export function GameTimer({ startedAt, frozenMs }: GameTimerProps) {
  const frozen = frozenMs != null;
  // Dummy re-render trigger — the value is unused; `Date.now()` at
  // render time is the actual source of truth.
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (frozen) return;
    const id = window.setInterval(() => forceTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [frozen]);

  const displayMs = frozen
    ? Math.max(0, frozenMs as number)
    : Math.max(0, Date.now() - startedAt);

  return (
    <div
      className="inline-flex items-center rounded-pill bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-1 text-sm font-semibold tabular-nums"
      aria-live="off"
    >
      {formatMs(displayMs)}
    </div>
  );
}
