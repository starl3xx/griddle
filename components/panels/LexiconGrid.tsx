'use client';

import { useEffect, useState } from 'react';
import { WORDMARK_CATALOG } from '@/lib/wordmarks/catalog';

interface LexiconGridProps {
  /**
   * Wallet to fetch wordmarks for. When null, the grid renders all
   * 17 wordmarks in the locked state with no fetch — consistent
   * with the rest of the stats panel's behavior for anonymous /
   * no-wallet users.
   */
  wallet: string | null;
}

/**
 * Lexicon grid on the Stats panel — full 4×5 layout (17 wordmarks
 * + 3 empty slots) showing earned wordmarks in full color and
 * unearned ones grayed out. Modeled on Let's Have A Word's
 * `FAQSheet`-style Lexicon panel: bold header with "Your Wordmarks
 * · N/M", three-column rounded circle grid, name under each badge.
 *
 * Data flow: fetches /api/wordmarks/[wallet] on mount when a wallet
 * is available. The earned set is a Set<WordmarkId> for O(1) membership
 * checks. Empty wallet → no fetch → everything locked.
 *
 * Order comes from WORDMARK_CATALOG (already sorted by Z-index), so
 * earned wordmarks interleave with locked ones and the most
 * prestigious appear top-left.
 */
export function LexiconGrid({ wallet }: LexiconGridProps) {
  const [earned, setEarned] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!wallet) {
      setEarned(new Set());
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/wordmarks/${wallet}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { entries?: Array<{ wordmarkId: string }> } | null) => {
        if (cancelled) return;
        setEarned(new Set((j?.entries ?? []).map((e) => e.wordmarkId)));
        setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [wallet]);

  const earnedCount = earned.size;
  const total = WORDMARK_CATALOG.length;

  return (
    <div className="mt-4 border-t border-gray-100 dark:border-gray-800 pt-4">
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
          return (
            <li
              key={w.id}
              className="flex flex-col items-center text-center"
              title={w.description}
            >
              <div
                className={`w-14 h-14 rounded-full flex items-center justify-center text-2xl transition-colors duration-fast ${
                  isEarned
                    ? 'bg-accent/15 ring-2 ring-accent/40'
                    : 'bg-gray-100 dark:bg-gray-700/60 opacity-50'
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
