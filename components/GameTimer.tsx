'use client';

import { useEffect, useState } from 'react';
import { formatMs } from '@/lib/format';

interface GameTimerProps {
  /** Epoch ms when the Start button was pressed. */
  startedAt: number;
  /** Freeze when false (solve landed, modal is opening). */
  running: boolean;
  /**
   * When running=false, prefer this authoritative server-computed
   * duration over `Date.now() - startedAt`. Keeps the final displayed
   * number aligned with what the solve modal and leaderboard show,
   * even if the client clock drifted.
   */
  frozenMs?: number | null;
}

/**
 * Running solve timer above the grid. Ticks once per second — subsecond
 * smoothing adds re-renders without any perceptual benefit at mm:ss
 * resolution. Stops ticking on `running=false`, then snaps to
 * `frozenMs` if provided so the displayed number matches the server.
 */
export function GameTimer({ startedAt, running, frozenMs }: GameTimerProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  const elapsed =
    !running && typeof frozenMs === 'number'
      ? Math.max(0, frozenMs)
      : Math.max(0, now - startedAt);

  return (
    <div
      className="mt-1 text-4xl sm:text-5xl font-black tabular-nums text-gray-900 dark:text-gray-100"
      aria-live="off"
    >
      {formatMs(elapsed)}
    </div>
  );
}
