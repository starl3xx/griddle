'use client';

interface FoundWordsProps {
  words: string[];
}

/**
 * Color tier for each valid length, cool → warm within the site
 * palette. Longer words are closer to the 9-letter target, so the
 * warmer reward colors (amber, red) escalate anticipation as the
 * player approaches the goal:
 *
 *   4 letters  → brand blue     (coolest — "first find")
 *   5 letters  → accent purple  ("nice one")
 *   6 letters  → warning amber  ("getting close")
 *   7 letters  → warning deep   ("really close")
 *   8 letters  → error red      (warmest — one letter short of solving)
 *
 * All five tiers live in Griddle's existing Tailwind color families
 * (brand / accent / warning / error) so the strip stays in-theme.
 */
const LENGTH_CLASSES: Record<number, string> = {
  4: 'bg-brand-50 text-brand-700 border-brand-200',
  5: 'bg-accent-50 text-accent-700 border-accent-200',
  6: 'bg-warning-50 text-warning-700 border-warning-200',
  7: 'bg-warning-100 text-warning-800 border-warning-300',
  8: 'bg-error-50 text-error-700 border-error-200',
};

/**
 * Horizontal pill strip of 4-8 letter words the player has built on
 * their way to the target 9-letter solution. The list persists across
 * backspaces AND Reset button clicks — only a confirmed solve or a
 * full page reload clears it. Newest-first ordering mirrors the
 * dictionary hit order from `useGriddle`.
 *
 * Each pill is color-tiered by length (cool → warm) and labeled with
 * its letter count in parentheses so the player sees at a glance how
 * close each find is to the 9-letter target.
 *
 * Positioned above the grid as the single source of mid-attempt word
 * feedback — replaces the older `FlashBadge` which duplicated this
 * signal in a transient popup. Renders a fixed-height container when
 * empty so the grid doesn't shift vertically when the first word
 * lands.
 */
export function FoundWords({ words }: FoundWordsProps) {
  return (
    <div className="w-full max-w-[420px] min-h-[28px] flex flex-wrap justify-center items-center gap-1.5">
      {words.map((w) => {
        const tier = LENGTH_CLASSES[w.length] ?? LENGTH_CLASSES[4];
        return (
          <span
            key={w}
            className={`inline-flex items-center rounded-pill border px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider tabular-nums animate-fade-in ${tier}`}
            title={`${w.length} letters`}
          >
            {w} ({w.length})
          </span>
        );
      })}
    </div>
  );
}
