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
 * solver's result; the puzzle URL is passed alongside via the
 * Web Share API / Farcaster embed, so iMessage renders the OG
 * card above this single-line message.
 *
 * Example output:
 *
 *   I solved Griddle #042 in 03:24 ◆ unassisted
 */
export function formatShareText({
  dayNumber,
  solved,
  timeMs,
  unassisted = false,
}: ShareInput): string {
  const paddedDay = dayNumber.toString().padStart(3, '0');

  if (!solved || timeMs === undefined) {
    // Defensive: no current caller hits this path (SolveModal only
    // shares confirmed solves), but keep something coherent if a
    // future surface wants to share an unfinished attempt.
    return `Griddle #${paddedDay} got me — try it: ${SITE_HOST}`;
  }

  const suffix = unassisted ? ' ◆ unassisted' : '';
  return `I solved Griddle #${paddedDay} in ${formatShareTime(timeMs)}${suffix}`;
}

/**
 * MM:SS (or H:MM:SS past an hour) with a zero-padded minutes field.
 * Different from `formatMs`, which leaves single-digit minutes
 * unpadded for the in-app timer (`3:24`). Share text reads cleaner
 * with `03:24` because it sits inline next to other digits ("Griddle
 * #007 in 03:24") and the consistent width avoids the visual jitter
 * of mixed-width numbers.
 */
function formatShareTime(ms: number): string {
  const t = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}
