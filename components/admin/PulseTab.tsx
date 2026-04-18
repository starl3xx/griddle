'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Pulse,
  Warning,
  Crown,
  CircleNotch,
  ArrowsClockwise,
  TrendUp,
  Users,
  Clock,
  PuzzlePiece,
  Coins,
  Receipt,
} from '@phosphor-icons/react';
import { formatMsCompact as formatMs } from '@/lib/format';
import { SparklineCard } from './charts/SparklineCard';
import { TrendLine } from './charts/TrendLine';
import { StackedBar } from './charts/StackedBar';
import { SpoilerAnswer } from './SpoilerAnswer';
import { tierTone } from './tierTone';

interface PulsePayload {
  headline: {
    solves24h: number;
    solves7d: number;
    activeWallets7d: number;
    flaggedSolves24h: number;
    flaggedRatePct: number;
    premiumUsersTotal: number;
  };
  activity: {
    dau: number; prevDau: number;
    wau: number; prevWau: number;
    mau: number; prevMau: number;
  };
  dailySeries: Array<{ day: string; dau: number; solves: number }>;
  todaysPuzzle: {
    puzzleId: number;
    dayNumber: number;
    date: string;
    answer: string;
    heuristicScore: number;
    tier: string;
    solves: number;
    loads: number;
    starts: number;
    solveRate: number | null;
    avgServerMs: number | null;
    avgClientMs: number | null;
    wordmarksEarned: number;
  } | null;
  revenue: {
    crypto: { count: number; usd: number };
    fiatBurned: { count: number; usd: number };
    fiatPending: { count: number; usd: number };
    fiatRefunded: { count: number; usd: number };
    adminGrantCount: number;
    totalRealizedUsd: number;
  };
  revenueSeries: Array<{ day: string; crypto: number; fiat: number }>;
  /** Gross realized USD since 1st of current calendar month, authoritative. */
  mtdGross: number;
  opCostsMonthlyTotal: number;
}

/**
 * Pulse tab — the admin dashboard's headline view. Four rows:
 *   1. Today  — solves / DAU / avg solve time / hardest-of-today
 *   2. Trailing — WAU / MAU / flagged rate / premium total
 *   3. Revenue — MTD gross, breakdown, op costs, net
 *   4. Charts — 30-day solves + DAU, and revenue-by-day stacked bar
 *
 * Self-fetching; one round-trip to /api/admin/pulse pulls everything.
 */
export function PulseTab() {
  const [data, setData] = useState<PulsePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPulse = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/pulse', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      setData((await res.json()) as PulsePayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchPulse(); }, [fetchPulse]);

  if (loading && !data) {
    return <div className="flex justify-center py-12"><CircleNotch className="h-6 w-6 animate-spin text-gray-400 dark:text-gray-500" weight="bold" /></div>;
  }
  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-error mb-4">{error}</p>
        <Button variant="outline" size="sm" onClick={fetchPulse}>
          <ArrowsClockwise className="h-4 w-4 mr-2" weight="bold" />Retry
        </Button>
      </div>
    );
  }
  if (!data) return null;

  const flagTone =
    data.headline.flaggedRatePct >= 15 ? 'error'
    : data.headline.flaggedRatePct >= 5 ? 'warning'
    : 'ok';

  const solvesSeries = data.dailySeries.map((d) => ({ value: d.solves }));
  const dauSeries = data.dailySeries.map((d) => ({ value: d.dau }));
  const dauDelta = data.activity.prevDau > 0
    ? (data.activity.dau - data.activity.prevDau) / data.activity.prevDau
    : null;
  const wauDelta = data.activity.prevWau > 0
    ? (data.activity.wau - data.activity.prevWau) / data.activity.prevWau
    : null;
  const mauDelta = data.activity.prevMau > 0
    ? (data.activity.mau - data.activity.prevMau) / data.activity.prevMau
    : null;

  // MTD net = (realized revenue since 1st of month) − (op-costs
  // prorated to the same window). Revenue's `mtdGross` comes from
  // the server with a `date_trunc('month', now())` filter — i.e.
  // its window starts at midnight UTC on day 1. Costs have to
  // prorate against that exact same window.
  //
  // Compute the fraction of the month that has ACTUALLY elapsed
  // (ms-precision), not a day-of-month integer. `getUTCDate()`
  // returns 1 all day long on the 1st, so using it directly
  // would charge a full day of op-costs at 00:00 UTC when zero
  // revenue has been booked yet — net margin would look
  // misleadingly negative for all of day 1.
  const now = new Date();
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const monthEnd = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  const monthFraction = (now.getTime() - monthStart) / (monthEnd - monthStart);
  const opCostMtd = data.opCostsMonthlyTotal * monthFraction;
  const netMtd = data.mtdGross - opCostMtd;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold tracking-tight text-gray-900 dark:text-gray-100">Pulse</h2>
        <Button variant="ghost" size="sm" onClick={fetchPulse} disabled={loading} aria-label="Refresh">
          {loading ? <CircleNotch className="h-4 w-4 animate-spin" weight="bold" /> : <ArrowsClockwise className="h-4 w-4" weight="bold" />}
        </Button>
      </div>

      {/* Row 1 — Today */}
      <section className="space-y-2">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Today</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <SparklineCard
            icon={<Pulse className="h-4 w-4" weight="bold" />}
            label="Solves · 24h"
            value={data.headline.solves24h}
            sub="last 24 hours"
            series={solvesSeries}
          />
          <SparklineCard
            icon={<Users className="h-4 w-4" weight="bold" />}
            label="DAU"
            value={data.activity.dau}
            sub={`vs ${data.activity.prevDau} yesterday`}
            series={dauSeries}
            delta={dauDelta}
            deltaKind="pct"
          />
          <SparklineCard
            icon={<Clock className="h-4 w-4" weight="bold" />}
            label="Avg solve time · today"
            value={data.todaysPuzzle?.avgServerMs ? formatMs(data.todaysPuzzle.avgServerMs) : '—'}
            sub={data.todaysPuzzle ? `${data.todaysPuzzle.solves} solves` : 'no data'}
          />
          <HardestWordTile today={data.todaysPuzzle} />
        </div>
      </section>

      {/* Row 2 — Trailing */}
      <section className="space-y-2">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Trailing</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <SparklineCard
            icon={<TrendUp className="h-4 w-4" weight="bold" />}
            label="WAU · 7d"
            value={data.activity.wau}
            sub={`vs ${data.activity.prevWau} prev 7d`}
            delta={wauDelta}
            deltaKind="pct"
          />
          <SparklineCard
            icon={<TrendUp className="h-4 w-4" weight="bold" />}
            label="MAU · 30d"
            value={data.activity.mau}
            sub={`vs ${data.activity.prevMau} prev 30d`}
            delta={mauDelta}
            deltaKind="pct"
          />
          <SparklineCard
            icon={<Warning className="h-4 w-4" weight="bold" />}
            label="Flagged · 24h"
            value={data.headline.flaggedSolves24h}
            sub={`${data.headline.flaggedRatePct.toFixed(1)}% of today`}
            tone={flagTone}
          />
          <SparklineCard
            icon={<Crown className="h-4 w-4" weight="bold" />}
            label="Premium users"
            value={data.headline.premiumUsersTotal}
            sub="all-time"
            tone="accent"
          />
        </div>
      </section>

      {/* Row 3 — Revenue (month-to-date for math consistency; Fiat
          pending is a rolling 30-day balance since it's an "owed,
          not yet booked" status not a time-window figure). */}
      <section className="space-y-2">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Revenue · month-to-date</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <SparklineCard
            icon={<Coins className="h-4 w-4" weight="bold" />}
            label="Gross MTD"
            value={`$${data.mtdGross.toFixed(0)}`}
            sub="realized revenue this month"
            tone="accent"
          />
          <SparklineCard
            icon={<Crown className="h-4 w-4" weight="bold" />}
            label="Fiat pending"
            value={`$${data.revenue.fiatPending.usd.toFixed(0)}`}
            sub={`${data.revenue.fiatPending.count} in escrow · rolling 30d`}
            tone={data.revenue.fiatPending.count > 0 ? 'warning' : 'ok'}
          />
          <SparklineCard
            icon={<Receipt className="h-4 w-4" weight="bold" />}
            label="Op costs MTD"
            value={`$${opCostMtd.toFixed(0)}`}
            sub={`$${data.opCostsMonthlyTotal.toFixed(0)}/mo prorated`}
          />
          <SparklineCard
            icon={<TrendUp className="h-4 w-4" weight="bold" />}
            label="Net MTD"
            value={`$${netMtd.toFixed(0)}`}
            sub={netMtd >= 0 ? 'in the black' : 'in the red'}
            tone={netMtd >= 0 ? 'accent' : 'error'}
          />
        </div>
      </section>

      {/* Row 4 — Charts */}
      <section className="space-y-2">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Trends · last 30d</h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Solves & DAU per day</CardTitle>
            </CardHeader>
            <CardContent>
              <TrendLine
                data={data.dailySeries}
                series={[
                  { dataKey: 'solves', label: 'Solves', stroke: '#3b82f6', yAxisId: 'left' },
                  { dataKey: 'dau', label: 'DAU', stroke: '#10b981', yAxisId: 'right' },
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Revenue per day</CardTitle>
            </CardHeader>
            <CardContent>
              {data.revenueSeries.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 py-8 text-center">No revenue in the last 30 days.</p>
              ) : (
                <StackedBar
                  data={data.revenueSeries}
                  series={[
                    { dataKey: 'crypto', label: 'Crypto', fill: '#8b5cf6' },
                    { dataKey: 'fiat', label: 'Fiat', fill: '#06b6d4' },
                  ]}
                />
              )}
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}

function HardestWordTile({ today }: { today: PulsePayload['todaysPuzzle'] }) {
  const [revealed, setRevealed] = useState(false);
  if (!today) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-gray-400 dark:text-gray-500">
            <PuzzlePiece className="h-4 w-4" weight="bold" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Today's puzzle</span>
          </div>
          <div className="text-3xl font-black text-gray-900 dark:text-gray-100">—</div>
          <div className="text-[11px] text-gray-400 dark:text-gray-500">no data yet</div>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="flex flex-col gap-1">
        <div className="flex items-center gap-2 text-gray-400 dark:text-gray-500">
          <PuzzlePiece className="h-4 w-4" weight="bold" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Today's puzzle</span>
        </div>
        <SpoilerAnswer
          answer={today.answer}
          revealed={revealed}
          onToggle={() => setRevealed((r) => !r)}
          size="lg"
        />
        <div className="flex items-center gap-2 text-[11px]">
          <span className={`rounded px-1.5 py-0.5 font-bold ${tierTone(today.tier)}`}>
            {today.tier}
          </span>
          <span className="text-gray-500 dark:text-gray-400">heuristic {today.heuristicScore}</span>
          <span className="text-gray-300 dark:text-gray-600">·</span>
          <span className="text-gray-500 dark:text-gray-400">{today.solves} solves</span>
        </div>
      </CardContent>
    </Card>
  );
}
