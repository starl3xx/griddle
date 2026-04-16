/**
 * Wordmarks catalog — 17 achievement badges earned through gameplay.
 *
 * Each wordmark is:
 *   - exactly 9 letters long (matches the solution word length, on brand)
 *   - keyed by a short lowercase id used in the DB + on the wire
 *   - rendered with an emoji + short condition description
 *   - assigned a Z-index determining leaderboard display priority
 *   - optionally part of a group (speed / streak) with suppression rules
 *
 * Spec: WORDMARKS_SPEC.md (see repo README for pointer). The pseudocode
 * and the Z-index table in that doc are the authoritative references.
 */

export type WordmarkId =
  | 'fledgling'
  | 'blameless'
  | 'nightclub'
  | 'lightning'
  | 'quicksand'
  | 'clockwork'
  | 'wordsmith'
  | 'labyrinth'
  | 'fireproof'
  | 'steadfast'
  | 'centurion'
  | 'throwback'
  | 'goldfinch'
  | 'frontline'
  | 'unrivaled'
  | 'dauntless'
  | 'megaphone';

export type WordmarkGroup =
  | 'milestone'
  | 'skill'
  | 'speed'
  | 'streak'
  | 'leaderboard'
  | 'social';

export interface WordmarkMeta {
  id: WordmarkId;
  name: string;
  emoji: string;
  description: string;
  group: WordmarkGroup;
  /** Lower = higher priority on the leaderboard row (1 = most prestigious). */
  zIndex: number;
}

/**
 * Canonical catalog. Order here is meaningful: it matches the Z-index
 * order in the spec, so `WORDMARK_CATALOG.map(w => w.id)` gives you a
 * prestige-sorted list. The full Lexicon grid on the Stats panel also
 * renders in this order.
 */
export const WORDMARK_CATALOG: readonly WordmarkMeta[] = [
  { id: 'unrivaled', name: 'Unrivaled', emoji: '👑', group: 'leaderboard', zIndex: 1,
    description: 'Finish #1 for the day' },
  { id: 'dauntless', name: 'Dauntless', emoji: '💎', group: 'skill',       zIndex: 2,
    description: 'Solve without backspace, reset, or UI help' },
  { id: 'lightning', name: 'Lightning', emoji: '⚡', group: 'speed',       zIndex: 3,
    description: 'Solve in under 30 seconds' },
  { id: 'blameless', name: 'Blameless', emoji: '🎯', group: 'skill',       zIndex: 4,
    description: 'Solve without backspace or reset' },
  { id: 'nightclub', name: 'Nightclub', emoji: '🌑', group: 'skill',       zIndex: 5,
    description: 'Solve with UI help turned off' },
  { id: 'quicksand', name: 'Quicksand', emoji: '⏳', group: 'speed',       zIndex: 6,
    description: 'Solve in under 1 minute' },
  { id: 'centurion', name: 'Centurion', emoji: '🛡️', group: 'streak',      zIndex: 7,
    description: 'Maintain a 100-day streak' },
  { id: 'labyrinth', name: 'Labyrinth', emoji: '🌀', group: 'skill',       zIndex: 8,
    description: 'Find an 8-letter crumb unrelated to the solution' },
  { id: 'wordsmith', name: 'Wordsmith', emoji: '🔎', group: 'skill',       zIndex: 9,
    description: 'Find 9 or more crumbs before solving' },
  { id: 'clockwork', name: 'Clockwork', emoji: '⏲️', group: 'speed',       zIndex: 10,
    description: 'Solve in under 3 minutes' },
  { id: 'steadfast', name: 'Steadfast', emoji: '🪨', group: 'streak',      zIndex: 11,
    description: 'Maintain a 30-day streak' },
  { id: 'goldfinch', name: 'Goldfinch', emoji: '🪶', group: 'milestone',   zIndex: 12,
    description: 'Solve 100 puzzles' },
  { id: 'frontline', name: 'Frontline', emoji: '🏆', group: 'leaderboard', zIndex: 13,
    description: 'Finish in the top 10' },
  { id: 'fireproof', name: 'Fireproof', emoji: '🔥', group: 'streak',      zIndex: 14,
    description: 'Maintain a 7-day streak' },
  { id: 'throwback', name: 'Throwback', emoji: '🗃️', group: 'milestone',   zIndex: 15,
    description: 'Solve a puzzle from the archive' },
  { id: 'megaphone', name: 'Megaphone', emoji: '📣', group: 'social',      zIndex: 16,
    description: 'Share a solve' },
  { id: 'fledgling', name: 'Fledgling', emoji: '🐣', group: 'milestone',   zIndex: 17,
    description: 'Solve your first puzzle' },
];

export const WORDMARK_BY_ID: Record<WordmarkId, WordmarkMeta> = Object.fromEntries(
  WORDMARK_CATALOG.map((w) => [w.id, w]),
) as Record<WordmarkId, WordmarkMeta>;

/** Lookup: wordmark id → Z-index. Used by the leaderboard top-3 selector. */
export const WORDMARK_ZINDEX: Record<WordmarkId, number> = Object.fromEntries(
  WORDMARK_CATALOG.map((w) => [w.id, w.zIndex]),
) as Record<WordmarkId, number>;

/**
 * Group suppression + leaderboard row selection (`getLeaderboardWordmarks`,
 * `SPEED_GROUP`, `STREAK_GROUP`) land in the follow-up PR that wires
 * up-to-3 wordmark emojis into leaderboard rows. Keeping them out of
 * this PR since they'd ship as dead code — no caller yet.
 */

/**
 * Type guard — is this arbitrary string a known wordmark id?
 *
 * Uses `Object.hasOwn` rather than `in` because `in` traverses the
 * prototype chain: on a plain object created via `Object.fromEntries`,
 * `in` returns true for 'toString', 'constructor', 'valueOf', etc.
 * That would cause `SolveModal` (which filters earned ids through
 * this guard and then indexes into `WORDMARK_BY_ID`) to pull out
 * inherited prototype methods instead of catalog entries and render
 * undefined badges.
 */
export function isWordmarkId(s: string): s is WordmarkId {
  return Object.hasOwn(WORDMARK_ZINDEX, s);
}
