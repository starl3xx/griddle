'use client';

import { useEffect, useState } from 'react';
import { formatCountdown, secondsUntilUtcMidnight } from '@/lib/format';

export function NextPuzzleCountdown() {
  const [seconds, setSeconds] = useState<number | null>(null);

  useEffect(() => {
    const update = () => setSeconds(secondsUntilUtcMidnight());
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  // Avoid SSR/client hydration mismatch — render nothing until the client
  // effect has computed the initial value.
  if (seconds === null) return null;

  return (
    <footer className="mt-auto pt-8 pb-4 text-center">
      <p className="text-xs font-medium text-gray-400 uppercase tracking-widest">
        Next puzzle in{' '}
        <span className="tabular-nums text-gray-600">{formatCountdown(seconds)}</span>
      </p>
    </footer>
  );
}
