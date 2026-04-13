import { formatMs } from './format';

/**
 * Display host for the share-text footer. Defaults to the current deployment
 * URL so shares work without any Vercel configuration. Can be overridden via
 * NEXT_PUBLIC_SITE_URL when the permanent domain is wired up — just flip the
 * default (or set the env var) at that point.
 */
export const SHARE_URL_HOST: string = (() => {
  const raw = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://griddle-five.vercel.app';
  return raw.replace(/^https?:\/\//, '').replace(/\/$/, '');
})();

export interface ShareInput {
  dayNumber: number;
  grid: string;
  solved: boolean;
  timeMs?: number;
  bestWord?: string;
  unassisted?: boolean;
}

/**
 * Plain-text share format — works in any surface (SMS, clipboard,
 * Farcaster cast text, Twitter, iMessage). Never reveals the target
 * word; only shows the grid letters and the solver’s result.
 *
 * Example output:
 *
 *   Griddle #042
 *
 *   A  E  F
 *   T  O  G
 *   L  R  W
 *
 *   Solved in 3:24 ◆ unassisted
 *   griddle.fun
 */
export function formatShareText({
  dayNumber,
  grid,
  solved,
  timeMs,
  bestWord,
  unassisted = false,
}: ShareInput): string {
  const paddedDay = dayNumber.toString().padStart(3, '0');
  const row = (start: number) =>
    [grid[start], grid[start + 1], grid[start + 2]]
      .map((c) => c.toUpperCase())
      .join('  ');

  const gridBlock = [row(0), row(3), row(6)].join('\n');

  let result: string;
  if (solved && timeMs !== undefined) {
    result = `Solved in ${formatMs(timeMs)}${unassisted ? ' ◆ unassisted' : ''}`;
  } else if (bestWord) {
    result = `Best: ${bestWord.toUpperCase()} (${bestWord.length} letters)`;
  } else {
    result = 'Unsolved';
  }

  return `Griddle #${paddedDay}\n\n${gridBlock}\n\n${result}\n${SHARE_URL_HOST}`;
}
