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
 * provided (integers map 1:1 via modulo; fractional seeds floor
 * first) so tests and SSR can pin the choice; otherwise uses
 * `Math.random()` for live usage.
 */
export function pickOpener(seed?: number): string {
  const i =
    seed == null
      ? Math.floor(Math.random() * SOLVE_OPENERS.length)
      : Math.abs(Math.floor(seed)) % SOLVE_OPENERS.length;
  return SOLVE_OPENERS[i];
}
