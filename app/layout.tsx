import type { Metadata, Viewport } from 'next';
import '@/styles/globals.css';
import { SITE_URL } from '@/lib/site';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Griddle — daily 3×3 word puzzle',
    template: '%s · Griddle',
  },
  description:
    'A daily 3×3 word puzzle. Find the hidden 9-letter word using every cell exactly once. Consecutive letters can’t be neighbors.',
  applicationName: 'Griddle',
  keywords: ['word game', 'puzzle', 'daily', 'farcaster', 'base', '$WORD'],
  authors: [{ name: 'starl3xx' }],
  creator: 'starl3xx',
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: 'Griddle',
    title: 'Griddle — daily 3×3 word puzzle',
    description:
      'Find the hidden 9-letter word. Consecutive letters can’t be neighbors.',
    images: [
      {
        url: '/api/og',
        width: 1200,
        height: 630,
        alt: 'Griddle — daily 3×3 word puzzle',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Griddle — daily 3×3 word puzzle',
    description:
      'Find the hidden 9-letter word. Consecutive letters can’t be neighbors.',
    images: ['/api/og'],
  },
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: [{ url: '/apple-icon.svg', type: 'image/svg+xml' }],
  },
  robots: {
    index: true,
    follow: true,
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
      <body className="min-h-screen bg-white flex flex-col">{children}</body>
    </html>
  );
}
