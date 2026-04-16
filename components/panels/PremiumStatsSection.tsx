'use client';

import { useEffect, useState } from 'react';
import { Diamond } from '@phosphor-icons/react';
import { formatMs } from '@/lib/format';
import type { PremiumStats } from '@/lib/db/queries';

interface PremiumStatsSectionProps {
  wallet: string | null;
  premium: boolean;
  onUpgrade: () => void;
}

interface PremiumStatsResponse {
  wallet: string | null;
  stats: PremiumStats | null;
}

/**
 * Premium stats dashboard — sparkline, last-7-days bar chart, today's
 * percentile, and career placements. Rendered inside `StatsPanel`
 * after the basic `StatsGrid`, gated on `hasAccount` by the parent.
 *
 * Render matrix:
 *   - premium + wallet → fetch `/api/stats/premium`, render real data
 *   - free / no wallet → placeholder data behind a blur + upgrade CTA
 *
 * All charts are pure SVG — no D3 / Recharts / etc. Dark-mode is
 * handled via Tailwind `dark:` variants on stroke/fill utility classes.
 */
export function PremiumStatsSection({
  wallet,
  premium,
  onUpgrade,
}: PremiumStatsSectionProps) {
  const [stats, setStats] = useState<PremiumStats | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!premium || !wallet) return;
    let cancelled = false;
    setLoading(true);
    fetch('/api/stats/premium')
      .then((r) => (r.ok ? r.json() : null))
      .then((j: PremiumStatsResponse | null) => {
        if (!cancelled) {
          setStats(j?.stats ?? null);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [premium, wallet]);

  const data = premium && stats ? stats : PLACEHOLDER_STATS;
  const isPreview = !premium;

  return (
    <section className="mt-5 relative animate-fade-in">
      <div
        className={[
          'space-y-4',
          isPreview ? 'opacity-40 blur-[2px] pointer-events-none select-none' : '',
        ].join(' ')}
        aria-hidden={isPreview ? true : undefined}
      >
        {loading && !stats ? (
          <ChartsSkeleton />
        ) : (
          <>
            <SolveTrendSparkline points={data.solveTrend} />
            <LastSevenDaysBars days={data.last7Days} />
            <PercentileBlock rank={data.percentileRank} />
            <PodiumTile placements={data.placements} />
          </>
        )}
      </div>

      {isPreview && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="bg-white dark:bg-gray-800 border border-accent/30 rounded-md px-4 py-3 shadow-card text-center space-y-2 max-w-[240px]">
            <Diamond className="w-5 h-5 text-accent mx-auto" weight="fill" aria-hidden />
            <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
              Unlock with Premium
            </p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-snug">
              See your solve trend, weekly pacing, today’s percentile, and career podium.
            </p>
            <button type="button" onClick={onUpgrade} className="btn-primary w-full text-xs">
              See Premium options
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Sparkline ─────────────────────────────────────────────────────

function SolveTrendSparkline({ points }: { points: PremiumStats['solveTrend'] }) {
  // Tight, readable SVG: 420×80 internal viewBox that scales to any
  // container via width="100%". Line + subtle fill below. Empty state
  // renders a placeholder message rather than a flat line at y=0.
  const H = 80;
  const W = 420;
  const padX = 8;
  const padY = 10;

  if (points.length < 2) {
    return (
      <div className="bg-gray-50 dark:bg-gray-800 rounded-md p-3">
        <StatHeader label="Solve trend" />
        <p className="text-xs text-gray-500 mt-2 text-center py-4">
          Solve a few more puzzles to see your trend.
        </p>
      </div>
    );
  }

  const times = points.map((p) => p.serverSolveMs);
  const min = Math.min(...times);
  const max = Math.max(...times);
  const range = max - min || 1;

  const dx = (W - padX * 2) / Math.max(1, points.length - 1);
  const xy = points.map((p, i) => {
    const x = padX + i * dx;
    // y inverted so faster (smaller ms) is higher on screen.
    const y = padY + ((p.serverSolveMs - min) / range) * (H - padY * 2);
    return [x, H - y] as const;
  });

  const line = xy.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${xy[xy.length - 1][0].toFixed(1)},${H} L${xy[0][0].toFixed(1)},${H} Z`;

  return (
    <div className="bg-gray-50 dark:bg-gray-800 rounded-md p-3">
      <div className="flex items-center justify-between">
        <StatHeader label="Solve trend" />
        <span className="text-[10px] font-medium text-gray-400 tabular-nums">
          {points.length} solves
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full h-20 mt-2"
        role="img"
        aria-label={`Sparkline of the last ${points.length} solve times`}
      >
        <defs>
          <linearGradient id="griddle-spark-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.25" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#griddle-spark-fill)" className="text-brand dark:text-brand-400" />
        <path
          d={line}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinejoin="round"
          strokeLinecap="round"
          className="text-brand dark:text-brand-400"
        />
      </svg>
      <div className="flex justify-between text-[10px] font-medium text-gray-500 tabular-nums mt-1">
        <span>Fastest {formatMs(min)}</span>
        <span>Slowest {formatMs(max)}</span>
      </div>
    </div>
  );
}

// ─── Last 7 days bar chart ────────────────────────────────────────

function LastSevenDaysBars({ days }: { days: PremiumStats['last7Days'] }) {
  // One bar per day. Taller = slower. Null solve → dotted placeholder.
  const times = days.map((d) => d.serverSolveMs).filter((n): n is number => n != null);
  const max = times.length ? Math.max(...times) : 1;

  return (
    <div className="bg-gray-50 dark:bg-gray-800 rounded-md p-3">
      <StatHeader label="Last 7 days" />
      <div className="flex items-end justify-between gap-1.5 h-24 mt-2">
        {days.map((d) => {
          const heightPct =
            d.serverSolveMs == null ? 0 : Math.max(8, (d.serverSolveMs / max) * 100);
          const weekday = new Date(`${d.date}T00:00:00Z`).toLocaleDateString('en-US', {
            weekday: 'short',
            timeZone: 'UTC',
          });
          return (
            <div key={d.dayNumber} className="flex-1 flex flex-col items-center gap-1">
              {d.serverSolveMs == null ? (
                <div
                  className="w-full h-full rounded-sm border-2 border-dashed border-gray-300 dark:border-gray-600"
                  aria-label={`${weekday}: no solve`}
                />
              ) : (
                <div
                  className="w-full rounded-sm bg-brand dark:bg-brand-400 flex items-end justify-center"
                  style={{ height: `${heightPct}%` }}
                  title={`${weekday}: ${formatMs(d.serverSolveMs)}`}
                  aria-label={`${weekday}: ${formatMs(d.serverSolveMs)}`}
                />
              )}
              <span className="text-[9px] font-bold uppercase tracking-wider text-gray-500 tabular-nums">
                {weekday.slice(0, 3)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Percentile ───────────────────────────────────────────────────

function PercentileBlock({ rank }: { rank: number | null }) {
  return (
    <div className="bg-gray-50 dark:bg-gray-800 rounded-md p-3 text-center">
      <StatHeader label="Today" center />
      {rank == null ? (
        <p className="text-xs text-gray-500 mt-2">Solve today’s puzzle to see your rank.</p>
      ) : (
        <>
          <div className="mt-1 text-2xl font-black text-brand dark:text-brand-400 tabular-nums">
            Top {Math.max(1, 100 - rank)}%
          </div>
          <p className="text-[11px] font-medium text-gray-500 mt-0.5 tabular-nums">
            Faster than {rank}% of the field
          </p>
        </>
      )}
    </div>
  );
}

// ─── Podium ───────────────────────────────────────────────────────

function PodiumTile({ placements }: { placements: PremiumStats['placements'] }) {
  // Stepped bars: 1st tallest (center), 2nd medium (left), 3rd shortest (right).
  // Classic podium ordering — not left-to-right by rank.
  return (
    <div className="bg-gray-50 dark:bg-gray-800 rounded-md p-3">
      <StatHeader label="Career podium" />
      <div className="flex items-end justify-center gap-3 h-24 mt-2">
        <PodiumBar place={2} count={placements.second} heightPct={70} colorClass="bg-[#C0C0C0]" />
        <PodiumBar place={1} count={placements.first} heightPct={100} colorClass="bg-[#FFD700]" />
        <PodiumBar place={3} count={placements.third} heightPct={50} colorClass="bg-[#CD7F32]" />
      </div>
      <p className="text-center text-xs font-medium text-gray-500 mt-2 tabular-nums">
        <span className="font-bold text-gray-900 dark:text-gray-100">{placements.topTen}</span>{' '}
        top-10 finish{placements.topTen === 1 ? '' : 'es'}
      </p>
    </div>
  );
}

function PodiumBar({
  place,
  count,
  heightPct,
  colorClass,
}: {
  place: number;
  count: number;
  heightPct: number;
  colorClass: string;
}) {
  return (
    <div className="flex-1 max-w-[72px] flex flex-col items-center gap-1">
      <div
        className={`w-full rounded-t-sm flex items-start justify-center pt-1 ${colorClass}`}
        style={{ height: `${heightPct}%` }}
      >
        <span className="text-xs font-black text-gray-900 tabular-nums">{count}</span>
      </div>
      <span className="text-[9px] font-bold uppercase tracking-wider text-gray-500 tabular-nums">
        {place === 1 ? '1st' : place === 2 ? '2nd' : '3rd'}
      </span>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────

function StatHeader({ label, center }: { label: string; center?: boolean }) {
  return (
    <div
      className={[
        'text-[10px] font-bold uppercase tracking-wider text-gray-500',
        center ? 'text-center' : '',
      ].join(' ')}
    >
      {label}
    </div>
  );
}

function ChartsSkeleton() {
  return (
    <div className="space-y-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-24 rounded-md bg-gray-100 dark:bg-gray-800 animate-pulse" />
      ))}
    </div>
  );
}

// Placeholder data for the free-user blurred preview. Shapes mirror a
// realistic player ("top ~15%", 14 solves trending faster over time,
// steady week) so the teaser looks populated rather than mocked.
const PLACEHOLDER_STATS: PremiumStats = {
  solveTrend: Array.from({ length: 14 }, (_, i) => ({
    dayNumber: i + 1,
    serverSolveMs: 45_000 - i * 1200 + Math.sin(i) * 3000,
  })),
  last7Days: Array.from({ length: 7 }, (_, i) => ({
    dayNumber: i + 1,
    date: `2026-04-${10 + i}`,
    serverSolveMs: i === 3 ? null : 28_000 + Math.sin(i * 1.3) * 8000,
  })),
  percentileRank: 85,
  placements: { first: 2, second: 5, third: 7, topTen: 23 },
};
