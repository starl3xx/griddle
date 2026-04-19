'use client';

import { useCallback, useEffect, useState } from 'react';

const LS_KEY = 'griddle_haptics_v1';

/**
 * Haptics preference — subtle vibrations on grid keystrokes, shake, and
 * solve. Default ON. Honored by `lib/haptics.ts`'s `fireHaptic()` via the
 * same localStorage key, so non-React call sites (tight game-loop
 * callbacks) don't need to thread a context.
 *
 * Shape matches `useDarkMode` / `useZenMode` — `{ haptics, toggle }` — so
 * the SettingsModal `ToggleRow` consumes it with zero adapter code.
 *
 * Per-device only (localStorage). Cross-device sync via user_settings is
 * a later enhancement if anyone asks; tactile preference reasonably
 * differs between iPad / iPhone / desktop anyway.
 */
export function useHaptics() {
  const [haptics, setHaptics] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      const v = window.localStorage.getItem(LS_KEY);
      return v === null ? true : v === '1';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(LS_KEY, haptics ? '1' : '0');
    } catch {
      /* best-effort — private mode / quota errors */
    }
  }, [haptics]);

  const toggle = useCallback(() => {
    setHaptics((prev) => !prev);
  }, []);

  return { haptics, toggle } as const;
}
