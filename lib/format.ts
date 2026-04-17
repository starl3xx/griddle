/**
 * Small formatting helpers shared across UI + share surfaces.
 */

export function formatMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  return formatSeconds(totalSeconds);
}

/**
 * Human solve time. Short solves stay compact (`M:SS`) so the common
 * case — a sub-minute to ~45 min finish — reads tight. Anything past an
 * hour switches to `H:MM:SS` so a 13-hour session doesn't render as
 * `790:44`. Mirrors `formatCountdown`'s hours branch for consistency.
 */
export function formatSeconds(totalSeconds: number): string {
  const t = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

export function formatCountdown(totalSeconds: number): string {
  const t = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/**
 * Full English month names, Jan–Dec (index 0–11). Exported so UI
 * surfaces that need per-month labels can reuse the same copy as
 * `formatLongDate` instead of re-declaring the array.
 */
export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Render a puzzle's ISO date (`YYYY-MM-DD`, the shape Postgres’s
 * `date` type marshals to) as a long human date like "April 16, 2026".
 *
 * Parses the string by hand rather than going through `new Date` —
 * `new Date('2026-04-16')` interprets as UTC midnight, which renders
 * as the *previous day* in every timezone west of UTC (e.g. US users
 * would see April 15). Splitting on `-` keeps the calendar date stable
 * regardless of the viewer's locale.
 *
 * Falls back to the raw input if parsing fails, so a bad row in the
 * DB never produces the literal string "undefined" in the UI.
 */
export function formatLongDate(iso: string): string {
  const parts = iso.split('-');
  if (parts.length < 3) return iso;
  const year = parts[0];
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return iso;
  const monthName = MONTH_NAMES[month - 1];
  if (!monthName) return iso;
  return `${monthName} ${day}, ${year}`;
}

/**
 * Seconds remaining until the next UTC midnight.
 */
export function secondsUntilUtcMidnight(now: Date = new Date()): number {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return Math.max(0, Math.floor((next.getTime() - now.getTime()) / 1000));
}

/**
 * Display name for a player on the leaderboard / stats surfaces.
 * Preference order: handle → truncated wallet → "Anonymous". The
 * last branch is defensive; server filters exclude rows with neither
 * handle nor wallet from public views.
 */
export function formatPlayerName({
  handle,
  wallet,
}: {
  handle: string | null;
  wallet: string | null;
}): string {
  if (handle) return handle;
  if (wallet) return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
  return 'Anonymous';
}
