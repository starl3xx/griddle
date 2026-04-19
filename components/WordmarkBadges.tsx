'use client';

import { useEffect, useRef, useState } from 'react';
import {
  WORDMARK_BY_ID,
  WORDMARK_THEMES,
  isWordmarkId,
} from '@/lib/wordmarks/catalog';

/**
 * Overlapping circular-badge row for a leaderboard entry's top
 * wordmarks. Each badge keeps its themed color ring in both light and
 * dark mode — a bright outer halo is part of the wordmark's visual
 * identity, not a dark-mode-only accent — and the outline fills the
 * overlap gap so adjacent badges read as separate discs instead of a
 * blurred strip.
 *
 * On tap, the badge toggles a small name label above itself — the
 * same "round info" pattern Let's Have A Word uses on leaderboard
 * rows. `title` is preserved for desktop hover; the tap label is the
 * mobile-first path since `title` tooltips don't fire on touch.
 *
 * Client component: the tap-to-reveal tooltip needs state + a click-
 * outside listener. Used by both the client `LeaderboardPanel` and the
 * SSR `/leaderboard/[day]` page; hydrates as an island in the latter.
 */
export function WordmarkBadges({ ids }: { ids: readonly string[] }) {
  const valid = ids.filter(isWordmarkId);
  const [openId, setOpenId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openId) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpenId(null);
    };
    // Auto-dismiss after 2s so a tap-and-walk-away doesn't leave the
    // label hanging. Long enough to read "Lightning" comfortably.
    const t = setTimeout(() => setOpenId(null), 2000);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      clearTimeout(t);
    };
  }, [openId]);

  if (valid.length === 0) return null;
  return (
    <div
      ref={containerRef}
      className="flex -space-x-1.5 flex-shrink-0"
    >
      {valid.map((id) => {
        const w = WORDMARK_BY_ID[id];
        const theme = WORDMARK_THEMES[id];
        const isOpen = openId === id;
        return (
          <button
            key={id}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpenId(isOpen ? null : id);
            }}
            aria-label={w.name}
            title={`${w.name} · ${w.description}`}
            className={`relative w-5 h-5 rounded-full ${theme.bg} ring-2 ${theme.ring} outline outline-2 outline-white dark:outline-gray-800 flex items-center justify-center text-[10px] leading-none ${
              isOpen ? 'z-20' : ''
            }`}
          >
            <span aria-hidden>{w.emoji}</span>
            {isOpen && (
              <span className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 dark:bg-gray-700 px-2 py-0.5 text-[10px] font-bold text-white shadow-lg z-30">
                {w.name}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
