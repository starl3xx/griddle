import type { MetadataRoute } from 'next';
import { SITE_NAME, SITE_SHORT_NAME, SITE_DESCRIPTION } from '@/lib/site';

/**
 * PWA web app manifest. Next.js serves this at `/manifest.webmanifest` and
 * auto-injects the `<link rel="manifest">` tag into every page. That means
 * browsers get the "Add to Home Screen" / installable-app affordance, and
 * the device stores Griddle as a standalone app with the correct icon,
 * theme color, and splash behavior.
 *
 * Name + description are imported from `lib/site.ts` so the PWA install
 * prompt, page metadata, and social previews stay in lockstep — one
 * source of truth, no drift.
 *
 * The icons intentionally reuse the same SVGs that the favicon metadata
 * points at — one set of assets for favicon, apple-touch-icon, OG image,
 * Farcaster manifest, and now PWA install. The only reason to add raster
 * variants later is if a specific platform (older iOS, Windows tiles)
 * can’t consume the SVGs.
 */
export default function manifest(): MetadataRoute.Manifest {
  // `url_handlers` tells supporting browsers (Chromium on Android /
  // desktop) to route in-scope links to the installed PWA when the
  // user taps one outside the app — including the magic-link
  // verify URL opened from an email client. Unsupported platforms
  // (iOS Safari) ignore the field; PWA users on iOS fall back to
  // pasting the 6-digit code into Settings.
  //
  // Next.js's `MetadataRoute.Manifest` type doesn't include this
  // field yet, so we assemble the manifest as a plain object and
  // cast at the return — the emitted JSON is still a valid Web
  // App Manifest per the W3C spec regardless of the Next typing.
  const manifestObj: MetadataRoute.Manifest & {
    url_handlers?: { origin: string }[];
  } = {
    name: SITE_NAME,
    short_name: SITE_SHORT_NAME,
    description: SITE_DESCRIPTION,
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#2D68C7',
    orientation: 'portrait',
    categories: ['games', 'entertainment'],
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/apple-touch-icon.png',
        sizes: '180x180',
        type: 'image/png',
        purpose: 'any',
      },
    ],
    url_handlers: [{ origin: 'https://griddle.fun' }],
  };
  return manifestObj;
}
