/**
 * Shared Tailwind class map for puzzle difficulty tier pills. Single
 * source of truth so PulseTab's Today's-puzzle tile and PuzzlesTab's
 * heuristic tables always render the same color for a given tier,
 * and the fallback for an unknown tier also stays in sync.
 */
export const TIER_TONE: Record<string, string> = {
  Gentle: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300',
  Easy: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400',
  Medium: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-300',
  Hard: 'bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-300',
  Brutal: 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300',
};

/** Gray pill used when a puzzle's tier doesn't match a known bucket. */
export const TIER_TONE_FALLBACK =
  'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300';

export function tierTone(tier: string): string {
  return TIER_TONE[tier] ?? TIER_TONE_FALLBACK;
}
