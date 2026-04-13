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
  return {
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
        src: '/apple-icon.svg',
        sizes: '180x180',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
  };
}
