import type { Metadata, Viewport } from 'next';
import { Analytics } from '@vercel/analytics/next';
import '@/styles/globals.css';
import {
  SITE_URL,
  SITE_NAME,
  SITE_DESCRIPTION,
  SITE_SHORT_DESCRIPTION,
} from '@/lib/site';

const TITLE_DEFAULT = `${SITE_NAME} | Daily 3×3 word puzzle`;

// Farcaster Mini App embed — rendered when griddle.fun is cast as a URL.
// The <meta name="fc:miniapp"> tag is what Farcaster clients scrape to show
// an inline launch card; the farcaster.json manifest only drives the app
// directory listing, not in-cast embeds. We also emit the legacy `fc:frame`
// alias for clients that haven't migrated. Image must be 3:2, hence the
// dedicated /api/og/embed endpoint (the default /api/og is 1200x630).
const MINI_APP_EMBED = {
  version: '1',
  imageUrl: `${SITE_URL}/api/og/embed`,
  button: {
    title: "Play today's Griddle",
    action: {
      type: 'launch_miniapp',
      name: SITE_NAME,
      url: SITE_URL,
      splashImageUrl: `${SITE_URL}/icon.svg`,
      splashBackgroundColor: '#FFFFFF',
    },
  },
} as const;

const LEGACY_FRAME_EMBED = {
  ...MINI_APP_EMBED,
  button: {
    ...MINI_APP_EMBED.button,
    action: { ...MINI_APP_EMBED.button.action, type: 'launch_frame' as const },
  },
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE_DEFAULT,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: ['word game', 'puzzle', 'daily', 'farcaster', 'base', '$WORD'],
  authors: [{ name: 'starl3xx' }],
  creator: 'starl3xx',
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: SITE_NAME,
    title: TITLE_DEFAULT,
    description: SITE_SHORT_DESCRIPTION,
    images: [
      {
        url: '/api/og',
        width: 1200,
        height: 630,
        alt: TITLE_DEFAULT,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE_DEFAULT,
    description: SITE_SHORT_DESCRIPTION,
    images: ['/api/og'],
  },
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-icon.svg', type: 'image/svg+xml' },
      { url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  robots: {
    index: true,
    follow: true,
  },
  other: {
    'fc:miniapp': JSON.stringify(MINI_APP_EMBED),
    'fc:frame': JSON.stringify(LEGACY_FRAME_EMBED),
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#2D68C7',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white flex flex-col">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
