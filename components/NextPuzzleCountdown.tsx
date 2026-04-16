'use client';

import { useEffect, useState } from 'react';
import { formatCountdown, secondsUntilUtcMidnight } from '@/lib/format';

export function NextPuzzleCountdown() {
  const [seconds, setSeconds] = useState<number | null>(null);

  useEffect(() => {
    const update = () => setSeconds(secondsUntilUtcMidnight());
    update();

    let id: ReturnType<typeof setInterval> | null = null;

    // Pause the 1s tick when the tab is hidden — there's no observer
    // watching the footer in a background tab, and browsers throttle
    // setInterval in hidden tabs anyway. Resume on visibility change,
    // refreshing immediately so the first visible frame isn't stale.
    const start = () => {
      if (id != null) return;
      id = setInterval(update, 1000);
    };
    const stop = () => {
      if (id == null) return;
      clearInterval(id);
      id = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        update();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // Avoid SSR/client hydration mismatch — render nothing until the client
  // effect has computed the initial value.
  if (seconds === null) return null;

  return (
    <footer className="mt-auto pt-8 pb-4 text-center">
      <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-widest">
        Next puzzle in{' '}
        <span className="tabular-nums text-gray-600 dark:text-gray-400">{formatCountdown(seconds)}</span>
      </p>
    </footer>
  );
}
