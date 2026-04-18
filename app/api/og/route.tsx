import { ImageResponse } from 'next/og';
import { getCurrentDayNumber } from '@/lib/scheduler';
import { formatSeconds } from '@/lib/format';
import { SITE_HOST } from '@/lib/site';

export const runtime = 'edge';

/**
 * Dynamic OG image for Griddle share cards.
 *
 * Spoiler-safe by design: the grid letters are NEVER rendered here,
 * because rich link previews (iMessage, Slack, Twitter, Farcaster)
 * would leak the grid to recipients before they've tapped START —
 * breaking the equal-footing blur-on-open flow. Instead we render a
 * branded 3×3 tile pattern in the same visual language as the
 * How-to-Play illustration: corners green (available), edges gray
 * (blocked), center brand blue (current). Instantly recognizable as
 * Griddle, zero letters leaked.
 *
 * Query params (all optional):
 *   puzzle=NNN     day number (defaults to today's puzzle), shown in
 *                  the subtitle
 *   solved=true    render the solved-state variant
 *   time=204       solve time in seconds (used when solved=true)
 *
 * Rendered at 1200×630 (Twitter/OG standard). Runs on the Edge
 * runtime so cold start stays under ~50ms.
 */

const SIZE = { width: 1200, height: 630 } as const;
const BRAND = '#2D68C7';
const GRAY_500 = '#6b7280';
const GRAY_900 = '#111827';
// Tile colors mirror the app icon's palette (public/icon.svg) so the OG
// card reads as the same "brand stamp" as the home-screen icon.
const TILE_MINT_FILL = '#D1FAE5';
const TILE_MINT_STROKE = '#86EFAC';
const TILE_EDGE_FILL = '#F1F3F5';
const TILE_EDGE_STROKE = '#D9D9D9';

type CellState = 'available' | 'blocked' | 'current';

// Mirrors the TinyGridIllustration in TutorialModal: center is the
// "current" cell, the four orthogonal neighbors are "blocked" (off-
// limits), and the four diagonal corners are "available" (go). Same
// visual story as the real game grid — recognizable without letters.
const TILE_PATTERN: readonly CellState[] = [
  'available', 'blocked',  'available',
  'blocked',   'current',  'blocked',
  'available', 'blocked',  'available',
];

export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);

  const dayNumber = clampDayNumber(searchParams.get('puzzle'));
  const solved = searchParams.get('solved') === 'true';
  const time = parseTime(searchParams.get('time'));

  const [soehneBuch, soehneFett] = await Promise.all([
    fetch(new URL('./soehne-buch.ttf', import.meta.url)).then((r) => r.arrayBuffer()),
    fetch(new URL('./soehne-fett.ttf', import.meta.url)).then((r) => r.arrayBuffer()),
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
          justifyContent: 'flex-start',
          backgroundColor: 'white',
          fontFamily: 'Soehne',
          padding: '28px 40px 20px',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <div
            style={{
              display: 'flex',
              fontSize: '58px',
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
              fontSize: '22px',
              fontWeight: 400,
              color: GRAY_500,
              letterSpacing: '0.01em',
            }}
          >
            {`#${dayNumber.toString().padStart(3, '0')} · find the 9-letter word`}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            marginTop: '22px',
          }}
        >
          {[0, 3, 6].map((rowStart) => (
            <div
              key={rowStart}
              style={{ display: 'flex', flexDirection: 'row', gap: '12px' }}
            >
              {[0, 1, 2].map((col) => (
                <TileCell key={col} state={TILE_PATTERN[rowStart + col]} />
              ))}
            </div>
          ))}
        </div>

        {solved && time !== null ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: '12px',
              marginTop: '22px',
              color: GRAY_900,
            }}
          >
            <span
              style={{
                fontSize: '18px',
                fontWeight: 400,
                color: GRAY_500,
                textTransform: 'uppercase',
                letterSpacing: '0.14em',
              }}
            >
              Solved in
            </span>
            <span style={{ fontSize: '42px', fontWeight: 800, color: GRAY_900 }}>
              {formatSeconds(time)}
            </span>
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              fontSize: '22px',
              fontWeight: 400,
              color: GRAY_500,
              marginTop: '22px',
            }}
          >
            Can you beat it?
          </div>
        )}

        <div
          style={{
            display: 'flex',
            fontSize: '18px',
            fontWeight: 400,
            color: BRAND,
            marginTop: '14px',
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

function TileCell({ state }: { state: CellState }) {
  const { bg, border } = TILE_STYLES[state];
  return (
    <div
      style={{
        width: '100px',
        height: '100px',
        backgroundColor: bg,
        border: `4px solid ${border}`,
        borderRadius: '12px',
      }}
    />
  );
}

const TILE_STYLES: Record<CellState, { bg: string; border: string }> = {
  available: { bg: TILE_MINT_FILL, border: TILE_MINT_STROKE },
  blocked: { bg: TILE_EDGE_FILL, border: TILE_EDGE_STROKE },
  current: { bg: BRAND, border: BRAND },
};

function clampDayNumber(raw: string | null): number {
  const today = getCurrentDayNumber();
  if (raw === null) return today;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return today;
  return Math.min(n, today);
}

function parseTime(raw: string | null): number | null {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(n, 86_400);
}
