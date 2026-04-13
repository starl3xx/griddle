import type { MetadataRoute } from 'next';

/**
 * PWA web app manifest. Next.js serves this at `/manifest.webmanifest` and
 * auto-injects the `<link rel="manifest">` tag into every page. That means
 * browsers get the "Add to Home Screen" / installable-app affordance, and
 * the device stores Griddle as a standalone app with the correct icon,
 * theme color, and splash behavior.
 *
 * The icons intentionally reuse the same SVGs that the favicon metadata
 * points at — one set of assets for favicon, apple-touch-icon, OG image,
 * Farcaster manifest, and now PWA install. The only reason to add raster
 * variants later is if a specific platform (older iOS, Windows tiles)
 * can’t consume the SVGs.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Griddle',
    short_name: 'Griddle',
    description:
      'A daily 3×3 word puzzle. Find the hidden 9-letter word. Consecutive letters can’t be neighbors.',
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
