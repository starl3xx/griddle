import {
  SPEED_GROUP,
  STREAK_GROUP,
  WORDMARK_ZINDEX,
  type WordmarkId,
} from './catalog';

/**
 * Pick the top 3 wordmarks to display on a leaderboard row from a
 * player's earned set.
 *
 * Pipeline (order matters):
 *   1. **Group suppression** — within the speed group (Lightning /
 *      Quicksand / Clockwork) and the streak group (Centurion /
 *      Steadfast / Fireproof), only the highest-ranked earned
 *      wordmark survives. The other tiers are hidden on the row (but
 *      remain visible on the profile page).
 *   2. **Fledgling suppression** — Fledgling is the "first solve
 *      ever" badge. If the player has any other wordmark, Fledgling
 *      is hidden from the leaderboard row. It still shows on the
 *      full Lexicon grid.
 *   3. **Top 3 by Z-index** — sort by prestige (lower = higher) and
 *      take the first three.
 *
 * Input may contain unknown ids (future-proof — db rows outlive code
 * changes, and a stale cache could temporarily return a deprecated
 * id). Unknown ids are dropped silently.
 */
export function getLeaderboardWordmarks(earned: readonly string[]): WordmarkId[] {
  // Filter to known ids; drop anything we don't recognize.
  let pool: WordmarkId[] = earned.filter(
    (id): id is WordmarkId => id in WORDMARK_ZINDEX,
  );

  // Group suppression. For each group, if more than one tier is
  // earned, keep only the highest (lowest Z-index number).
  for (const group of [SPEED_GROUP, STREAK_GROUP]) {
    const inGroup = group.filter((g) => pool.includes(g));
    if (inGroup.length > 1) {
      const highest = [...inGroup].sort(
        (a, b) => WORDMARK_ZINDEX[a] - WORDMARK_ZINDEX[b],
      )[0];
      pool = pool.filter((w) => !group.includes(w) || w === highest);
    }
  }

  // Fledgling suppression: if anything else is earned, drop it.
  if (pool.length > 1) {
    pool = pool.filter((w) => w !== 'fledgling');
  }

  // Top 3 by prestige.
  return pool
    .sort((a, b) => WORDMARK_ZINDEX[a] - WORDMARK_ZINDEX[b])
    .slice(0, 3);
}
