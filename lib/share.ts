import { formatMs } from './format';
import { SITE_HOST } from './site';

export interface ShareInput {
  dayNumber: number;
  grid: string;
  solved: boolean;
  timeMs?: number;
  bestWord?: string;
  unassisted?: boolean;
}

/**
 * Convert an ASCII letter (or string of letters) to its Unicode "fullwidth"
 * form in the Halfwidth-and-Fullwidth-Forms block (U+FF21–U+FF3A for A–Z).
 * Fullwidth characters render at a fixed em width in virtually every font,
 * which is the trick that gives the share grid a monospace-aligned look
 * even on proportional-font surfaces (iMessage, Twitter, Farcaster, etc.).
 */
function toFullWidth(s: string): string {
  let out = '';
  for (const ch of s) {
    const code = ch.toUpperCase().charCodeAt(0);
    if (code >= 0x41 && code <= 0x5a) {
      out += String.fromCodePoint(0xff21 + (code - 0x41));
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Plain-text share format — works in any surface (SMS, clipboard,
 * Farcaster cast text, Twitter, iMessage). Never reveals the target
 * word; only shows the grid letters and the solver’s result.
 *
 * Example output (fullwidth letters render the grid as a uniform 3×3 even
 * in proportional fonts):
 *
 *   Griddle #042
 *
 *   ＡＥＦ
 *   ＴＯＧ
 *   ＬＲＷ
 *
 *   Solved in 3:24 ◆ unassisted
 *   griddle-fun.vercel.app
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

  const gridBlock = [
    toFullWidth(grid.slice(0, 3)),
    toFullWidth(grid.slice(3, 6)),
    toFullWidth(grid.slice(6, 9)),
  ].join('\n');

  let result: string;
  if (solved && timeMs !== undefined) {
    result = `Solved in ${formatMs(timeMs)}${unassisted ? ' ◆ unassisted' : ''}`;
  } else if (bestWord) {
    result = `Best: ${bestWord.toUpperCase()} (${bestWord.length} letters)`;
  } else {
    result = 'Unsolved';
  }

  return `Griddle #${paddedDay}\n\n${gridBlock}\n\n${result}\n${SITE_HOST}`;
}
