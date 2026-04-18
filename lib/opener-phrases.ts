/**
 * Celebration openers rendered at the top of the post-solve modal.
 * A random entry is chosen on each modal mount.
 *
 * Keep entries short (one or two words), exclamatory, and on-brand —
 * the tile style is "quiet enthusiasm", not sports-broadcast hype.
 * Jake curates this list directly; feel free to add / remove.
 */
export const SOLVE_OPENERS: readonly string[] = [
  'Congrats!',
  'Well done!',
  'Nice work!',
  'Awesome!',
  'Great solve!',
  'Brilliant!',
];

/**
 * Pick one opener pseudo-randomly. Deterministic w.r.t. `seed` when
 * provided so tests and SSR can pin the choice; otherwise uses
 * `Math.random()` for live usage.
 */
export function pickOpener(seed?: number): string {
  const r = seed == null ? Math.random() : ((seed % 1) + 1) % 1;
  const i = Math.floor(r * SOLVE_OPENERS.length) % SOLVE_OPENERS.length;
  return SOLVE_OPENERS[i];
}
