import { formatMs } from './format';
import { SITE_HOST } from './site';

export interface ShareInput {
  dayNumber: number;
  solved: boolean;
  timeMs?: number;
  unassisted?: boolean;
}

/**
 * Plain-text share format — works in any surface (SMS, clipboard,
 * Farcaster cast text, Twitter, iMessage). Spoiler-safe: never
 * reveals the grid letters or the target word. Recipients see the
 * solver's result and the link; the grid is revealed only after
 * they tap START at griddle.fun.
 *
 * Example output:
 *
 *   Griddle #042
 *   Solved in 3:24 ◆ unassisted
 *   griddle.fun
 */
export function formatShareText({
  dayNumber,
  solved,
  timeMs,
  unassisted = false,
}: ShareInput): string {
  const paddedDay = dayNumber.toString().padStart(3, '0');

  const result =
    solved && timeMs !== undefined
      ? `Solved in ${formatMs(timeMs)}${unassisted ? ' ◆ unassisted' : ''}`
      : 'Unsolved';

  return `Griddle #${paddedDay}\n${result}\n${SITE_HOST}`;
}
