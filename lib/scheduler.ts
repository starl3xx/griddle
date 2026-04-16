/**
 * Day-number math shared between the runtime (which puzzle is live
 * right now) and any admin tool that needs to compute a day from a
 * date. The day → puzzle mapping itself is **not** here — it lives in
 * the private Neon `puzzles` table and is read via
 * `getPuzzleByDay` / `getPuzzleWordByDayNumber` in `lib/db/queries.ts`.
 *
 * Previously this file also exported a deterministic `getPuzzleForDay`
 * that indexed into a public `PUZZLE_BANK` JSON bundle, meaning anyone
 * with the repo could compute any future puzzle. That bank has been
 * removed; the only way to resolve a day number to a word/grid now is
 * a DB lookup against the live schedule.
 */

/**
 * Canonical launch date for Griddle. Used at runtime by
 * `getCurrentDayNumber` and once at seed time (from a private source
 * outside this repo) to stamp each row's `date` column.
 */
export const LAUNCH_DATE = new Date('2026-04-13T00:00:00Z');

export function getCurrentDayNumber(now: Date = new Date()): number {
  const msPerDay = 86_400_000;
  const diff = now.getTime() - LAUNCH_DATE.getTime();
  return Math.max(1, Math.floor(diff / msPerDay) + 1);
}
