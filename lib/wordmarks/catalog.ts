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
 * Per-wordmark theme colors for the Lexicon badge (earned state). Each
 * entry maps to a distinct Tailwind tonal pair (light fill + ring
 * accent) thematically tied to the achievement — so the Lexicon grid
 * reads as a varied collection of collectibles rather than a uniform
 * pile of purple circles. Locked badges ignore this and fall back to
 * neutral gray in `LexiconGrid`.
 *
 * Literal class strings (not string-interpolated) so Tailwind's JIT
 * picks them up at build time. Purple is intentionally avoided
 * because it is reserved for Premium-indicator UI project-wide.
 */
export interface WordmarkTheme {
  /** Background tint behind the emoji. */
  bg: string;
  /** Ring accent — stronger hue of the same family for definition. */
  ring: string;
}

export const WORDMARK_THEMES: Record<WordmarkId, WordmarkTheme> = {
  unrivaled: { bg: 'bg-yellow-100 dark:bg-yellow-900/30',   ring: 'ring-yellow-500' },
  dauntless: { bg: 'bg-cyan-100 dark:bg-cyan-900/30',       ring: 'ring-cyan-500' },
  lightning: { bg: 'bg-amber-100 dark:bg-amber-900/30',     ring: 'ring-amber-400' },
  blameless: { bg: 'bg-emerald-100 dark:bg-emerald-900/30', ring: 'ring-emerald-500' },
  nightclub: { bg: 'bg-slate-200 dark:bg-slate-800',        ring: 'ring-slate-700' },
  quicksand: { bg: 'bg-orange-100 dark:bg-orange-900/30',   ring: 'ring-orange-400' },
  centurion: { bg: 'bg-stone-200 dark:bg-stone-800',        ring: 'ring-stone-600' },
  labyrinth: { bg: 'bg-teal-100 dark:bg-teal-900/30',       ring: 'ring-teal-500' },
  wordsmith: { bg: 'bg-sky-100 dark:bg-sky-900/30',         ring: 'ring-sky-500' },
  clockwork: { bg: 'bg-zinc-100 dark:bg-zinc-800',          ring: 'ring-zinc-500' },
  steadfast: { bg: 'bg-neutral-200 dark:bg-neutral-800',    ring: 'ring-neutral-500' },
  goldfinch: { bg: 'bg-amber-100 dark:bg-amber-900/30',     ring: 'ring-amber-600' },
  frontline: { bg: 'bg-rose-100 dark:bg-rose-900/30',       ring: 'ring-rose-500' },
  fireproof: { bg: 'bg-red-100 dark:bg-red-900/30',         ring: 'ring-red-500' },
  throwback: { bg: 'bg-stone-100 dark:bg-stone-800',        ring: 'ring-stone-400' },
  megaphone: { bg: 'bg-pink-100 dark:bg-pink-900/30',       ring: 'ring-pink-500' },
  fledgling: { bg: 'bg-lime-100 dark:bg-lime-900/30',       ring: 'ring-lime-500' },
};

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
