/**
 * Canonical site identity — URL, host, and marketing strings.
 *
 * Every surface that displays the site URL or site description must import
 * from here. Rule of thumb: if you find yourself writing "A daily 3×3 word
 * puzzle..." or `process.env.NEXT_PUBLIC_SITE_URL` anywhere else, stop and
 * import from this module instead. Copy-paste is how these fields drift.
 */

export const SITE_URL: string = (
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://griddle-fun.vercel.app'
).replace(/\/$/, '');

/** `SITE_URL` with the scheme stripped — for display in share text / OG footers. */
export const SITE_HOST: string = SITE_URL.replace(/^https?:\/\//, '');

/** Site name — used as page title, OG site name, PWA name, Farcaster frame name. */
export const SITE_NAME = 'Griddle';

/** Short site name for constrained surfaces (PWA short_name, tab titles). */
export const SITE_SHORT_NAME = 'Griddle';

/**
 * Canonical long description — used by page metadata, OG/Twitter card,
 * PWA manifest, and the Farcaster frame manifest. One source of truth so
 * the install prompt, social preview, and search snippet never drift.
 */
export const SITE_DESCRIPTION =
  'A daily 3×3 word puzzle. Find the hidden 9-letter word using every cell exactly once. Consecutive letters can’t be neighbors.';

/** Short description for constrained surfaces (subtitle, short meta). */
export const SITE_SHORT_DESCRIPTION =
  'Find the hidden 9-letter word. Consecutive letters can’t be neighbors.';
