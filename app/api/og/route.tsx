import { ImageResponse } from 'next/og';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { getCurrentDayNumber } from '@/lib/scheduler';
import { formatSeconds } from '@/lib/format';
import { SITE_HOST } from '@/lib/site';

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

export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);

  const dayNumber = clampDayNumber(searchParams.get('puzzle'));
  const rawGrid = searchParams.get('grid');
  // Grid fallback: if the caller didn't pass `?grid=`, look it up in
  // the DB. The grid for a given day is public (it's what every player
  // sees), but it's only known at runtime — the in-repo PUZZLE_BANK
  // was removed so future puzzles can't be derived from the codebase.
  // On any failure (DB down, row missing) we degrade to an empty grid
  // and render 9 blank cells rather than 500 the share image.
  const grid = normalizeGrid(rawGrid) ?? (await fetchGridForDay(dayNumber)) ?? '';
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
  const today = getCurrentDayNumber();
  if (raw === null) return today;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return today;
  // Clamp to today so /api/og?puzzle=500 can’t leak a future puzzle’s grid
  // to anyone willing to brute-force the URL. Past puzzles are fine —
  // future archive access will be its own route in M5.
  return Math.min(n, today);
}

function normalizeGrid(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.toLowerCase().replace(/[^a-z]/g, '');
  if (cleaned.length !== 9) return null;
  return cleaned;
}

async function fetchGridForDay(dayNumber: number): Promise<string | null> {
  try {
    const rows = await db.execute<{ grid: string }>(sql`
      SELECT grid FROM puzzles WHERE day_number = ${dayNumber} LIMIT 1
    `);
    const resolved = Array.isArray(rows) ? rows : (rows.rows ?? []);
    const grid = resolved[0]?.grid;
    return typeof grid === 'string' && grid.length === 9 ? grid.toLowerCase() : null;
  } catch (err) {
    console.warn('[og] grid lookup failed, falling back to blank cells', err);
    return null;
  }
}

function parseTime(raw: string | null): number | null {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(n, 86_400);
}

