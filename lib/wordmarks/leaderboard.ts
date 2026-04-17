/**
 * Leaderboard wordmark selection — picks up to 3 wordmarks to render
 * as overlapping circular badges next to a player's name. Applies the
 * group suppression rules from the WORDMARKS spec so the row isn't
 * dominated by a single category (e.g. a player who holds every speed
 * wordmark shouldn't burn all 3 slots on speed emojis).
 *
 * Rules:
 *   - Speed group (Lightning / Quicksand / Clockwork) — keep only the
 *     most prestigious one the player holds. A ⚡ holder ignores ⏳.
 *   - Streak group (Centurion / Steadfast / Fireproof) — same rule.
 *   - Everything else — no grouping, straight Z-index sort.
 *   - After dedupe, sort by Z-index (ascending = more prestigious) and
 *     take the top 3.
 *
 * Prestige order *within* each group is hard-coded here rather than
 * derived from `zIndex`, so rearranging the catalog Z-index never
 * silently changes leaderboard rendering.
 */

import { WORDMARK_BY_ID, isWordmarkId, type WordmarkId } from './catalog';

/** Speed wordmarks, in prestige order (first = most prestigious). */
const SPEED_GROUP: readonly WordmarkId[] = ['lightning', 'quicksand', 'clockwork'];

/** Streak wordmarks, in prestige order (first = most prestigious). */
const STREAK_GROUP: readonly WordmarkId[] = ['centurion', 'steadfast', 'fireproof'];

const LEADERBOARD_BADGE_LIMIT = 3;

/**
 * Given an arbitrary list of earned wordmark ids (may contain
 * duplicates, unknown ids, or already-deduped sets), return the top 3
 * ids to display on the leaderboard row.
 *
 * Unknown ids are dropped silently — the server may have stored a
 * wordmark id that the client bundle hasn't shipped yet (future-compat
 * or a stale cache). Rendering an undefined badge would worse than
 * showing one fewer.
 */
export function getLeaderboardWordmarks(ids: readonly string[]): WordmarkId[] {
  const held = new Set<WordmarkId>();
  for (const id of ids) {
    if (isWordmarkId(id)) held.add(id);
  }

  // Collapse speed + streak groups to their highest-held entry.
  collapseGroup(held, SPEED_GROUP);
  collapseGroup(held, STREAK_GROUP);

  // Sort the survivors by Z-index — lowest zIndex = most prestigious.
  return Array.from(held)
    .sort((a, b) => WORDMARK_BY_ID[a].zIndex - WORDMARK_BY_ID[b].zIndex)
    .slice(0, LEADERBOARD_BADGE_LIMIT);
}

function collapseGroup(held: Set<WordmarkId>, group: readonly WordmarkId[]): void {
  let keeperSeen = false;
  for (const id of group) {
    if (!held.has(id)) continue;
    if (!keeperSeen) {
      // First member (most prestigious) stays.
      keeperSeen = true;
      continue;
    }
    // Less prestigious members get dropped.
    held.delete(id);
  }
}
