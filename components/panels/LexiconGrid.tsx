'use client';

import { useEffect, useState } from 'react';
import { WORDMARK_CATALOG, WORDMARK_THEMES } from '@/lib/wordmarks/catalog';

interface LexiconGridProps {
  /**
   * True when the caller has an account identity (wallet OR profile).
   * Drives the fetch — anonymous sessions skip the network call and
   * render everything locked. The server resolves the caller's actual
   * identity from the session, so this prop is just a local optimization
   * to avoid the no-op round trip.
   */
  enabled: boolean;
}

/**
 * Lexicon grid on the Stats panel — full 4×5 layout (17 wordmarks
 * + 3 empty slots) showing earned wordmarks in full color and
 * unearned ones grayed out. Modeled on Let's Have A Word's
 * `FAQSheet`-style Lexicon panel: bold header with "Your Wordmarks
 * · N/M", three-column rounded circle grid, name under each badge.
 *
 * Data flow: fetches /api/wordmarks/me on mount when the caller has
 * an account. The server resolves the session's profile + wallet
 * bindings, so handle-only and email-auth users see their own
 * earned wordmarks here — the earlier `/api/wordmarks/[wallet]`
 * path was wallet-only. The earned set is a Set<WordmarkId> for
 * O(1) membership checks.
 *
 * Order comes from WORDMARK_CATALOG (already sorted by Z-index), so
 * earned wordmarks interleave with locked ones and the most
 * prestigious appear top-left.
 */
export function LexiconGrid({ enabled }: LexiconGridProps) {
  const [earned, setEarned] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setEarned(new Set());
      return;
    }
    let cancelled = false;
    setLoading(true);
    setEarned(new Set());
    fetch('/api/wordmarks/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { entries?: Array<{ wordmarkId: string }> } | null) => {
        if (cancelled) return;
        setEarned(new Set((j?.entries ?? []).map((e) => e.wordmarkId)));
        setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [enabled]);

  const earnedCount = earned.size;
  const total = WORDMARK_CATALOG.length;

  return (
    // Contained card treatment — soft accent-tinted fill with padding so
    // the whole Lexicon reads as a single collectible-gallery unit, the
    // way LHAW renders its Wordmarks panel.
    <div className="mt-4 rounded-card bg-accent-50 dark:bg-accent-900/15 border border-accent-100 dark:border-accent-900/30 p-4 sm:p-5">
      <div className="mb-3">
        <h3 className="text-base font-bold tracking-tight text-gray-900 dark:text-gray-100">
          Lexicon
        </h3>
        <p className="text-xs font-semibold text-accent tabular-nums">
          Your Wordmarks · {earnedCount}/{total}
          {loading && <span className="ml-2 text-gray-400 font-normal">loading…</span>}
        </p>
      </div>
      <ul className="grid grid-cols-3 gap-y-4 gap-x-2" role="list">
        {WORDMARK_CATALOG.map((w) => {
          const isEarned = earned.has(w.id);
          const theme = WORDMARK_THEMES[w.id];
          return (
            <li
              key={w.id}
              className="flex flex-col items-center text-center"
              title={w.description}
            >
              <div
                className={`w-14 h-14 rounded-full flex items-center justify-center text-2xl transition-colors duration-fast ring-2 ${
                  isEarned
                    ? `${theme.bg} ${theme.ring}`
                    : 'bg-gray-100 dark:bg-gray-700/60 ring-transparent opacity-50'
                }`}
                aria-hidden
              >
                <span className={isEarned ? '' : 'grayscale'}>{w.emoji}</span>
              </div>
              <span
                className={`mt-1.5 text-[11px] font-bold ${
                  isEarned
                    ? 'text-gray-900 dark:text-gray-100'
                    : 'text-gray-400 dark:text-gray-500'
                }`}
              >
                {w.name}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
