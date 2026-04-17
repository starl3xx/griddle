import {
  WORDMARK_BY_ID,
  WORDMARK_THEMES,
  isWordmarkId,
} from '@/lib/wordmarks/catalog';

/**
 * Overlapping circular-badge row for a leaderboard entry's top
 * wordmarks. Matches LHAW's leaderboard pattern — each badge is the
 * wordmark's emoji over the themed tonal fill, ringed in the list-
 * background color so adjacent badges read as separate discs instead
 * of a blurred strip.
 *
 * Single definition shared by the client LeaderboardPanel and the SSR
 * `/leaderboard/[day]` page. An earlier iteration inlined the same
 * code in both places, which immediately drifted (the SSR copy was
 * missing `dark:ring-gray-800`). Shared module = one place to update
 * when badge styling changes.
 *
 * No client-only APIs, so usable in both server and client
 * components. The dark-mode ring variant is a no-op on surfaces that
 * don't opt into dark mode — harmless in the SSR context.
 */
export function WordmarkBadges({ ids }: { ids: readonly string[] }) {
  const valid = ids.filter(isWordmarkId);
  if (valid.length === 0) return null;
  return (
    <div className="flex -space-x-1.5 flex-shrink-0" aria-hidden>
      {valid.map((id) => {
        const w = WORDMARK_BY_ID[id];
        const theme = WORDMARK_THEMES[id];
        return (
          <span
            key={id}
            title={`${w.name} · ${w.description}`}
            className={`w-5 h-5 rounded-full ${theme.bg} ring-2 ring-white dark:ring-gray-800 flex items-center justify-center text-[10px] leading-none`}
          >
            {w.emoji}
          </span>
        );
      })}
    </div>
  );
}
