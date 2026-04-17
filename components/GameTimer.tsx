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
 * Running solve timer above the grid. Ticks once per second while
 * `frozenMs` is null; freezes to `frozenMs` the moment it's non-null,
 * stopping the interval and ignoring the client clock entirely so
 * modal-close remounts can't inflate the display by picking up a
 * fresh `Date.now()` against the original startedAt.
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
      className="mt-1 text-4xl sm:text-5xl font-black tabular-nums text-gray-900 dark:text-gray-100"
      aria-live="off"
    >
      {formatMs(displayMs)}
    </div>
  );
}
