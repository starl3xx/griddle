/**
 * Deterministic SVG monogram avatar — every account gets a colored
 * letter tile when no custom or Farcaster image is set, so free users
 * never look like an anonymous silhouette. Pattern matches Slack /
 * Notion / Linear: free identity is "claimed and personalized," only
 * the *custom photo* is a Premium upgrade.
 *
 * Stable across renders and between client/server because the hash is
 * a plain string FNV-1a, so SSR and hydration produce identical bytes.
 * Returns a data URI so it can drop into any <img src=…> without a
 * Next/Image config or new asset host.
 */

const PALETTE_HUES = [
  10, 30, 50, 75, 100, 130, 160, 185, 210, 235, 260, 285, 310, 335,
];

function fnv1aHash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function pickInitial(seed: string): string {
  const trimmed = seed.trim();
  if (!trimmed) return '?';
  // Wallets start with 0x — skip the prefix so we don't render every
  // wallet user as the letter "0" or "X".
  if (/^0x[0-9a-f]+$/i.test(trimmed) && trimmed.length > 2) {
    return trimmed[2]!.toUpperCase();
  }
  // Strip leading non-letter chars (@, _, digits) so handles like
  // "_jake" or "1234bob" still produce a meaningful letter when one
  // exists. Falls back to the first raw character otherwise.
  const firstLetter = trimmed.match(/[a-zA-Z]/)?.[0];
  return (firstLetter ?? trimmed[0]!).toUpperCase();
}

/**
 * Returns a `data:image/svg+xml,…` URI for a 64×64 monogram tile.
 * Callers should treat the output as opaque and pass it as the avatar
 * URL. Sized at 64px to stay crisp at every Avatar.tsx preset; the SVG
 * scales to whatever box renders it.
 */
export function getDefaultAvatarDataUri(seed: string): string {
  const safeSeed = seed && seed.length > 0 ? seed : 'guest';
  const hash = fnv1aHash(safeSeed.toLowerCase());
  const hue = PALETTE_HUES[hash % PALETTE_HUES.length]!;
  const initial = pickInitial(safeSeed);
  const bg = `hsl(${hue} 65% 45%)`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" fill="${bg}"/>` +
    `<text x="32" y="32" fill="white" font-family="system-ui,-apple-system,Segoe UI,sans-serif" ` +
    `font-size="32" font-weight="600" text-anchor="middle" dominant-baseline="central">${initial}</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
