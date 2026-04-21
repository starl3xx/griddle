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
 * wordmarks. Avatar-stack pattern: each badge carries the colored
 * theme accent via `ring-1` (inner) plus a modal-bg-matching
 * `outline` (outer). When badges overlap, the front badge's outline
 * paints over the back badge's ring, creating the visual illusion of
 * gap between them without widening the cluster horizontally.
 *
 * The outline color follows the leaderboard modal sheet
 * (`bg-white` / `dark:bg-gray-800` via the `.modal-sheet` component
 * class in globals.css). If that ever changes, the outline color
 * here must track it or the separator will go out of sync.
 *
 * Outline-follows-border-radius needs Safari 16.4+ (March 2023);
 * older iOS renders a square outline around the circle. We treat
 * that as acceptable degradation — the bulk of iOS traffic is on
 * 17+ and the visual impact is minor (a slightly boxy separator,
 * not a broken layout).
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
            className={`w-4 h-4 rounded-full ${theme.bg} ring-1 ${theme.ring} outline outline-2 outline-white dark:outline-gray-800 flex items-center justify-center text-[10px] leading-none ${
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
