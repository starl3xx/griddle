'use client';

import { useEffect, useRef, useState } from 'react';
import {
  WORDMARK_BY_ID,
  WORDMARK_THEMES,
  isWordmarkId,
  type WordmarkId,
} from '@/lib/wordmarks/catalog';

/**
 * Overlapping circular-badge row for a leaderboard entry's top
 * wordmarks. Small ring-1 treatment aligned with Let's Have A Word's
 * leaderboard stack — the heavier ring-2 + outline-white variant
 * still lives on the Stats grid where each badge stands alone and
 * needs the extra visual weight. Leaderboard rows are tight; subtle
 * reads better here.
 *
 * Hover (desktop) or tap (mobile) surfaces the wordmark name as a
 * dark pill tooltip below the stack. Tapping does NOT re-order the
 * badges — the server picks the stack via wordmark priority, and
 * reshuffling it on tap would suggest the user can change their
 * prestige ranking.
 *
 * Client component: hover/tap state + click-outside listener.
 * Used by both the client `LeaderboardPanel` and the SSR
 * `/leaderboard/[day]` page; hydrates as an island in the latter.
 */
export function WordmarkBadges({ ids }: { ids: readonly string[] }) {
  const valid = ids.filter(isWordmarkId);
  const [activeId, setActiveId] = useState<WordmarkId | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeId) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setActiveId(null);
    };
    // Auto-dismiss so a tap-and-walk-away doesn't leave the pill
    // hanging. 2s is long enough to read "Lightning" comfortably.
    const t = setTimeout(() => setActiveId(null), 2000);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      clearTimeout(t);
    };
  }, [activeId]);

  if (valid.length === 0) return null;
  return (
    <div
      ref={containerRef}
      className="relative inline-flex items-center flex-shrink-0"
      onMouseLeave={() => setActiveId(null)}
    >
      {valid.map((id, i) => {
        const w = WORDMARK_BY_ID[id];
        const theme = WORDMARK_THEMES[id];
        return (
          <button
            key={id}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setActiveId((prev) => (prev === id ? null : id));
            }}
            onMouseEnter={() => setActiveId(id)}
            onFocus={() => setActiveId(id)}
            onBlur={() => setActiveId((prev) => (prev === id ? null : prev))}
            aria-label={w.name}
            className={`w-4 h-4 rounded-full ${theme.bg} ring-1 ${theme.ring} flex items-center justify-center text-[10px] leading-none ${
              i > 0 ? '-ml-1.5' : ''
            }`}
          >
            <span aria-hidden>{w.emoji}</span>
          </button>
        );
      })}
      {activeId && (
        <span className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-1 whitespace-nowrap rounded bg-gray-900 dark:bg-gray-700 px-2 py-1 text-xs font-bold text-white shadow-sm z-30">
          {WORDMARK_BY_ID[activeId].name}
        </span>
      )}
    </div>
  );
}
