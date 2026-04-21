import { ImageResponse } from 'next/og';
import { SITE_HOST } from '@/lib/site';
import { BRAND, GRAY_500, GRAY_900, TILE_PATTERN, TileCell } from '@/lib/og-tiles';

export const runtime = 'edge';

/**
 * 3:2 embed image for the Farcaster Mini App launch card.
 *
 * Rendered at 1200×800 (3:2) because that's what Farcaster clients
 * expect when rendering the embed preview for a cast. The default
 * /api/og is 1200×630 (Twitter/OG standard ~1.91:1) — close but not
 * 3:2, so it gets cropped/rejected by the Mini App validator.
 *
 * Intentionally static — no puzzle number, no solve time. This is the
 * "launch the app" card shown when griddle.fun is cast as a URL, not
 * a per-puzzle share card (which /api/og handles).
 */

const SIZE = { width: 1200, height: 800 } as const;
const TILE_SIZE = 110;

export async function GET(): Promise<Response> {
  const [soehneBuch, soehneFett] = await Promise.all([
    fetch(new URL('../soehne-buch.ttf', import.meta.url)).then((r) => r.arrayBuffer()),
    fetch(new URL('../soehne-fett.ttf', import.meta.url)).then((r) => r.arrayBuffer()),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'white',
          fontFamily: 'Soehne',
          padding: '48px',
          gap: '32px',
        }}
      >
        <div
          style={{
            display: 'flex',
            fontSize: '96px',
            fontWeight: 800,
            letterSpacing: '-0.02em',
            color: GRAY_900,
            lineHeight: 1,
          }}
        >
          Griddle
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
          }}
        >
          {[0, 3, 6].map((rowStart) => (
            <div
              key={rowStart}
              style={{ display: 'flex', flexDirection: 'row', gap: '14px' }}
            >
              {[0, 1, 2].map((col) => (
                <TileCell key={col} state={TILE_PATTERN[rowStart + col]} size={TILE_SIZE} />
              ))}
            </div>
          ))}
        </div>

        <div
          style={{
            display: 'flex',
            fontSize: '30px',
            fontWeight: 400,
            color: GRAY_500,
            letterSpacing: '0.01em',
          }}
        >
          Nine letters. No neighbors.
        </div>

        <div
          style={{
            display: 'flex',
            fontSize: '22px',
            fontWeight: 400,
            color: BRAND,
            letterSpacing: '0.02em',
          }}
        >
          {SITE_HOST}
        </div>
      </div>
    ),
    {
      ...SIZE,
      fonts: [
        { name: 'Soehne', data: soehneBuch, weight: 400, style: 'normal' },
        { name: 'Soehne', data: soehneFett, weight: 800, style: 'normal' },
      ],
    },
  );
}

