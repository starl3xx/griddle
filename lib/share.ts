import { formatSeconds } from './format';

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
    const time = formatSeconds(Math.round(timeMs / 1000));
    result = `Solved in ${time}${unassisted ? ' ◆ unassisted' : ''}`;
  } else if (bestWord) {
    result = `Best: ${bestWord.toUpperCase()} (${bestWord.length} letters)`;
  } else {
    result = 'Unsolved';
  }

  return `Griddle #${paddedDay}\n\n${gridBlock}\n\n${result}\ngriddle.fun`;
}
