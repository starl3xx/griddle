'use client';

import { useEffect, useState } from 'react';
import { formatMs } from '@/lib/format';

interface GameTimerProps {
  /** Epoch ms when the Start button was pressed. */
  startedAt: number;
}

/**
 * Running solve timer above the grid. Ticks once per second —
 * subsecond smoothing adds re-renders without any perceptual benefit
 * at mm:ss resolution. The parent controls visibility: mount only
 * while the player is actively solving, unmount the moment the solve
 * lands (state.solved) so the timer never shows an inflated value
 * on modal close.
 */
export function GameTimer({ startedAt }: GameTimerProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div
      className="mt-1 text-4xl sm:text-5xl font-black tabular-nums text-gray-900 dark:text-gray-100"
      aria-live="off"
    >
      {formatMs(Math.max(0, now - startedAt))}
    </div>
  );
}
