'use client';

import { useEffect, useState } from 'react';
import { formatMs } from '@/lib/format';

interface GameTimerProps {
  /** Epoch ms when the Start button was pressed. */
  startedAt: number;
  /** Freeze when false (solve landed, modal is opening). */
  running: boolean;
}

/**
 * Running solve timer above the grid. Ticks once per second — subsecond
 * smoothing adds re-renders without any perceptual benefit at mm:ss
 * resolution. Stops ticking on `running=false` and displays the last
 * tick value; the solve modal opens immediately afterward with the
 * authoritative server-computed time, so the frozen intermediate
 * number only shows during the ~1 s reveal animation.
 */
export function GameTimer({ startedAt, running }: GameTimerProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  const elapsed = Math.max(0, now - startedAt);

  return (
    <div
      className="mt-1 text-4xl sm:text-5xl font-black tabular-nums text-gray-900 dark:text-gray-100"
      aria-live="off"
    >
      {formatMs(elapsed)}
    </div>
  );
}
