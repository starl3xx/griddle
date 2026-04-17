'use client';

import { useCallback, useEffect, useState } from 'react';

const LS_KEY = 'griddle_zen_mode_v1';

/**
 * Zen mode — hides the in-game timer while playing. Purely
 * cosmetic: solves still record their server-authoritative duration,
 * the leaderboard still ranks by time, and the frozen-green pill
 * still flips on after a solve (just hidden too). All this does is
 * swallow the pill render in the header.
 *
 * Not gated on premium — everyone gets to turn the clock off if they
 * want. Persisted to localStorage only for now; cross-device sync
 * (via user_settings) is a later enhancement if anyone asks.
 *
 * Shape matches `useDarkMode` — `{ zen, toggle }` — so the Settings
 * ToggleRow can consume it with zero adapter code.
 */
export function useZenMode() {
  const [zen, setZen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(LS_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(LS_KEY, zen ? '1' : '0');
    } catch {
      /* best-effort — private mode / quota errors */
    }
  }, [zen]);

  const toggle = useCallback(() => {
    setZen((prev) => !prev);
  }, []);

  return { zen, toggle } as const;
}
