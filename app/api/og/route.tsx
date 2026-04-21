import { ImageResponse } from 'next/og';
import { getCurrentDayNumber } from '@/lib/scheduler';
import { formatSeconds } from '@/lib/format';
import { SITE_HOST } from '@/lib/site';
import { BRAND, GRAY_500, GRAY_900, TILE_PATTERN, TileCell } from '@/lib/og-tiles';

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
const TILE_SIZE = 100;

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
                <TileCell key={col} state={TILE_PATTERN[rowStart + col]} size={TILE_SIZE} />
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
