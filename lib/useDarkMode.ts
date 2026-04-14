'use client';

import { useCallback, useEffect, useState } from 'react';

const LS_KEY = 'griddle_dark_mode';

/**
 * Dark mode hook. Priority chain:
 *
 *   1. localStorage — immediate, works without a wallet, persists across
 *      page loads on this device.
 *   2. DB sync — when a wallet is connected and the preference changes,
 *      PATCH /api/settings so the choice follows the user across devices.
 *
 * Applies `class="dark"` to `<html>` so Tailwind's `dark:` variants work.
 * All CSS variables for dark mode live in globals.css.
 */
export function useDarkMode(sessionWallet: string | null) {
  const [dark, setDark] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(LS_KEY) === '1';
    } catch {
      return false;
    }
  });

  // Sync dark mode with DB when wallet connects.
  // Strategy: if the DB already has a row (hasSettings=true), apply its
  // value (user's cross-device preference wins). If no row exists yet,
  // write the local localStorage value to DB so the first connect
  // doesn't silently revert a preference the user just set.
  useEffect(() => {
    if (!sessionWallet) return;
    fetch('/api/settings')
      .then((r) => r.ok ? r.json() : null)
      .then((data: { darkModeEnabled?: boolean; hasSettings?: boolean } | null) => {
        if (!data) return;
        if (data.hasSettings) {
          // Real DB row — apply its value.
          setDark(!!data.darkModeEnabled);
        } else {
          // No row yet — push local preference to DB.
          setDark((current) => {
            fetch('/api/settings', {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ darkModeEnabled: current }),
            }).catch(() => {});
            return current;
          });
        }
      })
      .catch(() => {/* best-effort */});
  }, [sessionWallet]);

  // Apply class to <html> on every change.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.classList.toggle('dark', dark);
    try {
      window.localStorage.setItem(LS_KEY, dark ? '1' : '0');
    } catch {/* best-effort */}
  }, [dark]);

  const toggle = useCallback(() => {
    setDark((prev) => {
      const next = !prev;
      // Sync to DB if wallet connected — fire-and-forget.
      if (sessionWallet) {
        fetch('/api/settings', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ darkModeEnabled: next }),
        }).catch(() => {/* best-effort */});
      }
      return next;
    });
  }, [sessionWallet]);

  return { dark, toggle } as const;
}
