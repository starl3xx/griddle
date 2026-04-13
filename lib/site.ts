/**
 * Canonical site URL + host. Driven by NEXT_PUBLIC_SITE_URL so we can point
 * at the current deployment (e.g. a Vercel preview) until the permanent
 * domain is wired up. Every surface that needs to display or link to the
 * site root (metadata, share text, OG footer, future sitemap/robots) must
 * import from here — never inline `process.env.NEXT_PUBLIC_SITE_URL` or
 * copy the fallback default into multiple files.
 */

export const SITE_URL: string = (
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://griddle-fun.vercel.app'
).replace(/\/$/, '');

/** `SITE_URL` with the scheme stripped — for display in share text / OG footers. */
export const SITE_HOST: string = SITE_URL.replace(/^https?:\/\//, '');
