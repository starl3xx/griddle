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
  // Strategy: if DB has a row (hasSettings=true), apply it (cross-device wins).
  // If no row exists, push the local preference to DB so first connect doesn't
  // silently revert a preference the user set while anonymous.
  // Cleanup cancels stale fetches so a rapid wallet-switch can't apply an
  // old wallet's preference on top of the new one.
  useEffect(() => {
    if (!sessionWallet) return;
    let cancelled = false;

    fetch('/api/settings')
      .then((r) => r.ok ? r.json() : null)
      .then((data: { darkModeEnabled?: boolean; hasSettings?: boolean } | null) => {
        if (cancelled || !data) return;
        if (data.hasSettings) {
          setDark(!!data.darkModeEnabled);
        } else {
          // No row yet — read current dark state and push it to DB.
          // Capture outside the setter so no side-effect inside updater.
          const localDark = window.localStorage.getItem(LS_KEY) === '1';
          fetch('/api/settings', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ darkModeEnabled: localDark }),
          }).catch(() => {});
        }
      })
      .catch(() => {});

    return () => { cancelled = true; };
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
    // Compute next value outside the setter (pure updater), then fire
    // the DB sync as a separate side effect.
    setDark((prev) => !prev);
  }, []);

  // Sync DB on every dark-state change when wallet is present.
  // Separated from the setter so the updater stays pure (React Strict Mode
  // calls updaters twice; a fetch inside would fire duplicate requests).
  useEffect(() => {
    if (!sessionWallet) return;
    fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ darkModeEnabled: dark }),
    }).catch(() => {});
    // Intentionally no cleanup — PATCH is fire-and-forget and idempotent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark, sessionWallet]);

  return { dark, toggle } as const;
}
