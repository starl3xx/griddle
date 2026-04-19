'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatMs } from '@/lib/format';
import type { PremiumStats } from '@/lib/db/queries';

/**
 * Premium stats chart body. Loaded lazily by `PremiumStatsSection` so
 * the recharts bundle (~50KB gzipped) doesn't ship to free users —
 * they get the lightweight hand-rolled SVG placeholder behind the
 * upgrade overlay instead. Same four sections as before: solve trend
 * (recharts area), last 7 days (recharts bars), today's percentile
 * (text), career podium (CSS).
 *
 * The podium intentionally stays as pure HTML/CSS — it's a stylized
 * visual, not a real chart, and a recharts BarChart for three bars
 * fights the library's defaults more than it helps.
 */
export function PremiumStatsCharts({ stats }: { stats: PremiumStats }) {
  return (
    <div className="space-y-4">
      <SolveTrendSparkline points={stats.solveTrend} />
      <LastSevenDaysBars days={stats.last7Days} />
      <PercentileBlock rank={stats.percentileRank} />
      <PodiumTile placements={stats.placements} />
    </div>
  );
}

// ─── Sparkline ─────────────────────────────────────────────────────

function SolveTrendSparkline({ points }: { points: PremiumStats['solveTrend'] }) {
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

  const data = points.map((p) => ({
    dayNumber: p.dayNumber,
    serverSolveMs: p.serverSolveMs,
  }));
  const times = points.map((p) => p.serverSolveMs);
  const min = Math.min(...times);
  const max = Math.max(...times);

  return (
    <div className="bg-gray-50 dark:bg-gray-800 rounded-md p-3">
      <div className="flex items-center justify-between">
        <StatHeader label="Solve trend" />
        <span className="text-[10px] font-medium text-gray-400 tabular-nums">
          {points.length} solves
        </span>
      </div>
      <div className="h-20 mt-2 -mx-1 text-brand dark:text-brand-400">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="griddle-spark-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="currentColor" stopOpacity={0.25} />
                <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
              </linearGradient>
            </defs>
            {/* Hidden XAxis carries dayNumber so the tooltip label can
                show "Puzzle #<dayNumber>" instead of the array index
                recharts would default to. */}
            <XAxis dataKey="dayNumber" hide />
            {/* YAxis reversed so faster (smaller ms) renders at the
                top — matches the prior hand-rolled chart's semantics
                that "improvement = upward trend". Without `reversed`
                the area would invert and a player getting faster
                would visually look like they're regressing. */}
            <YAxis hide domain={[min, max]} reversed />
            <Tooltip
              cursor={{ stroke: 'currentColor', strokeOpacity: 0.2 }}
              contentStyle={{
                fontSize: 11,
                borderRadius: 6,
                border: '1px solid #e5e7eb',
                padding: '4px 8px',
              }}
              labelFormatter={(d) => `Puzzle #${d}`}
              formatter={(v) => [formatMs(Number(v)), 'Solve time']}
            />
            <Area
              type="monotone"
              dataKey="serverSolveMs"
              stroke="currentColor"
              strokeWidth={1.75}
              fill="url(#griddle-spark-fill)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="flex justify-between text-[10px] font-medium text-gray-500 tabular-nums mt-1">
        <span>Fastest {formatMs(min)}</span>
        <span>Slowest {formatMs(max)}</span>
      </div>
    </div>
  );
}

// ─── Last 7 days bar chart ────────────────────────────────────────

function LastSevenDaysBars({ days }: { days: PremiumStats['last7Days'] }) {
  // Empty days carry serverSolveMs=null. We render them as a dotted
  // outline at full height so the day's "missed" status reads at a
  // glance — matching the prior hand-rolled chart's behavior.
  const maxRealMs = Math.max(...days.map((d) => d.serverSolveMs ?? 0), 1);
  const data = days.map((d) => ({
    weekday: new Date(`${d.date}T00:00:00Z`).toLocaleDateString('en-US', {
      weekday: 'short',
      timeZone: 'UTC',
    }),
    serverSolveMs: d.serverSolveMs,
    isMissing: d.serverSolveMs == null,
    displayValue: d.serverSolveMs == null ? maxRealMs : d.serverSolveMs,
  }));
  const hasAny = days.some((d) => d.serverSolveMs != null);

  return (
    <div className="bg-gray-50 dark:bg-gray-800 rounded-md p-3">
      <StatHeader label="Last 7 days" />
      <div className="h-24 mt-2 text-brand dark:text-brand-400">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
            <XAxis
              dataKey="weekday"
              tick={{ fontSize: 9, fill: '#6b7280', fontWeight: 700 }}
              tickFormatter={(v: string) => v.slice(0, 3).toUpperCase()}
              axisLine={false}
              tickLine={false}
            />
            <YAxis hide />
            {hasAny && (
              <Tooltip
                cursor={{ fill: 'currentColor', fillOpacity: 0.05 }}
                contentStyle={{
                  fontSize: 11,
                  borderRadius: 6,
                  border: '1px solid #e5e7eb',
                  padding: '4px 8px',
                }}
                formatter={(_v, _name, item) => {
                  const ms = (item?.payload as { serverSolveMs: number | null })
                    ?.serverSolveMs;
                  return [ms == null ? 'No solve' : formatMs(ms), 'Time'];
                }}
              />
            )}
            <Bar
              dataKey="displayValue"
              radius={[2, 2, 0, 0]}
              isAnimationActive={false}
            >
              {data.map((d) => (
                <Cell
                  key={d.weekday}
                  fill={d.isMissing ? 'transparent' : 'currentColor'}
                  stroke={d.isMissing ? '#d1d5db' : 'transparent'}
                  strokeWidth={d.isMissing ? 2 : 0}
                  strokeDasharray={d.isMissing ? '3 3' : undefined}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── Percentile (text-only) ───────────────────────────────────────

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

// ─── Podium (CSS, not recharts) ───────────────────────────────────

function PodiumTile({ placements }: { placements: PremiumStats['placements'] }) {
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

// ─── Helper ───────────────────────────────────────────────────────

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
