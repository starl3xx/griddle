import { ImageResponse } from 'next/og';
import { getCurrentDayNumber, getPuzzleForDay } from '@/lib/scheduler';
import { formatSeconds } from '@/lib/format';

export const runtime = 'edge';

/**
 * Dynamic OG image for Griddle share cards.
 *
 * Query params (all optional):
 *   puzzle=NNN      day number (defaults to today’s puzzle)
 *   grid=ecduotian  9-letter grid string (defaults to the day’s grid)
 *   solved=true     render the solved-state variant
 *   time=204        solve time in seconds (used when solved=true)
 *
 * The target word is never an input — OG images only ever show the grid
 * letters the player would see, never the answer. This matches the same
 * "share the puzzle, not the solution" rule the share text follows.
 *
 * Rendered at 1200×630 (Twitter/OG standard). Runs on the Edge runtime for
 * ~50ms cold start. Font files are co-located with this route and loaded
 * via `new URL(..., import.meta.url)` so the Next.js bundler picks them up.
 */

const SIZE = { width: 1200, height: 630 } as const;
const BRAND = '#2D68C7';
const GRAY_300 = '#d1d5db';
const GRAY_500 = '#6b7280';
const GRAY_900 = '#111827';

/** Same env-driven host resolution as layout.tsx / share.ts. */
const FOOTER_HOST: string = (() => {
  const raw = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://griddle-fun.vercel.app';
  return raw.replace(/^https?:\/\//, '').replace(/\/$/, '');
})();

export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);

  const dayNumber = clampDayNumber(searchParams.get('puzzle'));
  const puzzle = getPuzzleForDay(dayNumber);
  const grid = normalizeGrid(searchParams.get('grid'), puzzle.grid);
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
            gap: '10px',
            marginTop: '22px',
          }}
        >
          {[0, 3, 6].map((rowStart) => (
            <div
              key={rowStart}
              style={{ display: 'flex', flexDirection: 'row', gap: '10px' }}
            >
              {[0, 1, 2].map((col) => (
                <GridCell key={col} letter={grid[rowStart + col] ?? ''} />
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
          {FOOTER_HOST}
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

function GridCell({ letter }: { letter: string }) {
  return (
    <div
      style={{
        width: '100px',
        height: '100px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'white',
        border: `4px solid ${GRAY_300}`,
        borderRadius: '12px',
        fontSize: '60px',
        fontWeight: 800,
        color: GRAY_900,
        textTransform: 'uppercase',
      }}
    >
      {letter.toUpperCase()}
    </div>
  );
}

function clampDayNumber(raw: string | null): number {
  if (raw === null) return getCurrentDayNumber();
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return getCurrentDayNumber();
  return Math.min(n, 999_999);
}

function normalizeGrid(raw: string | null, fallback: string): string {
  if (!raw) return fallback;
  const cleaned = raw.toLowerCase().replace(/[^a-z]/g, '');
  if (cleaned.length !== 9) return fallback;
  return cleaned;
}

function parseTime(raw: string | null): number | null {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(n, 86_400);
}

