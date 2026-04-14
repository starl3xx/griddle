'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const LS_KEY = 'griddle_dark_mode';

/**
 * Dark mode hook. Priority chain:
 *
 *   1. localStorage — immediate, works without a wallet, persists across
 *      page loads on this device.
 *   2. DB sync — when a wallet connects, read the DB preference (cross-device
 *      wins). After that, every user toggle PATCHes the new value to DB.
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

  // settingsLoaded: true once the wallet-connect GET has resolved.
  // The PATCH effect checks this ref so it never fires during the window
  // where the GET is in-flight — preventing the PATCH from overwriting
  // the DB before we've read the cross-device preference.
  const settingsLoaded = useRef(false);

  // Keep a stable ref to sessionWallet so the PATCH effect can read it
  // without listing it as a dependency (which would re-fire on every connect).
  const sessionWalletRef = useRef(sessionWallet);
  useEffect(() => { sessionWalletRef.current = sessionWallet; });

  // On wallet connect: GET settings, apply DB value or push local preference.
  // Sets settingsLoaded=true when done so the PATCH effect is unblocked.
  useEffect(() => {
    if (!sessionWallet) return;
    let cancelled = false;
    settingsLoaded.current = false;

    fetch('/api/settings')
      .then((r) => r.ok ? r.json() : null)
      .then((data: { darkModeEnabled?: boolean; hasSettings?: boolean } | null) => {
        if (cancelled || !data) return;
        if (data.hasSettings) {
          setDark(!!data.darkModeEnabled);
        } else {
          // No row yet — push local preference to DB.
          const localDark = window.localStorage.getItem(LS_KEY) === '1';
          fetch('/api/settings', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ darkModeEnabled: localDark }),
          }).catch(() => {});
        }
        settingsLoaded.current = true;
      })
      .catch(() => { settingsLoaded.current = true; });

    return () => { cancelled = true; };
  }, [sessionWallet]);

  // Apply class to <html> and persist to localStorage.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.classList.toggle('dark', dark);
    try { window.localStorage.setItem(LS_KEY, dark ? '1' : '0'); }
    catch {/* best-effort */}
  }, [dark]);

  // PATCH DB when dark changes — but ONLY after settings have been fetched.
  // This prevents the race where a page-load PATCH overwrites the DB before
  // the GET reads the cross-device preference on wallet connect.
  // deps: [dark] only — sessionWallet read via ref so connect doesn't re-fire.
  useEffect(() => {
    if (!sessionWalletRef.current || !settingsLoaded.current) return;
    fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ darkModeEnabled: dark }),
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark]);

  const toggle = useCallback(() => {
    setDark((prev) => !prev);
  }, []);

  return { dark, toggle } as const;
}
