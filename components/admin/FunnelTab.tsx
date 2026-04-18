'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CircleNotch, ArrowsClockwise, ChartLineUp, Timer, Target } from '@phosphor-icons/react';
import { formatMsCompact as formatMs } from '@/lib/format';
import type {
  FunnelWindow,
  FunnelStageRow,
  FunnelBreakdownRow,
  FunnelStats,
  FunnelDropOffRow,
  FunnelEntryPointRow,
  FunnelTimeToStage,
} from '@/lib/funnel/types';

const STAGE_ORDER: { name: string; label: string }[] = [
  { name: 'stats_opened',       label: 'Stats opened' },
  { name: 'premium_gate_shown', label: 'Premium gate shown' },
  { name: 'upgrade_clicked',    label: 'Upgrade clicked' },
  { name: 'checkout_started',   label: 'Checkout started' },
  { name: 'checkout_completed', label: 'Checkout completed' },
];

const OTHER_EVENT_LABELS: Record<string, string> = {
  checkout_failed:    'Checkout failed',
  profile_identified: 'Profile identified',
  profile_created:    'Profile created',
};

const WINDOW_LABELS: Record<FunnelWindow, string> = {
  '24h': '24 hours',
  '7d':  '7 days',
  '30d': '30 days',
  'all': 'All time',
};

interface FunnelPayload {
  stats: FunnelStats;
  dropOff: FunnelDropOffRow[];
  entryPoints: FunnelEntryPointRow[];
  timeToStage: FunnelTimeToStage;
}

/**
 * Funnel tab — actionable conversion insights.
 *
 * Sections:
 *   - Stages with drop-off % between each step (horizontal bars)
 *   - Other signals (checkout_failed, profile_* events) — unchanged
 *   - Entry points: premium_gate_shown grouped by feature → conversion
 *   - Time to stage: medians for first-play → profile → gate → upgrade → checkout
 *   - Time-to-convert per method (existing)
 */
export function FunnelTab() {
  const [win, setWin] = useState<FunnelWindow>('7d');
  const [data, setData] = useState<FunnelPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/funnel?window=${win}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Failed to load (${res.status})`);
        setData(await res.json() as FunnelPayload);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [win, retryNonce]);

  const stageMap = useMemo(() => {
    const m = new Map<string, FunnelStageRow>();
    data?.stats.stages.forEach((s) => m.set(s.eventName, s));
    return m;
  }, [data]);

  const breakdownByEvent = useMemo(() => {
    const m = new Map<string, FunnelBreakdownRow[]>();
    data?.stats.breakdown.forEach((b) => {
      const list = m.get(b.eventName) ?? [];
      list.push(b);
      m.set(b.eventName, list);
    });
    m.forEach((list) => list.sort((a, b) => b.sessions - a.sessions));
    return m;
  }, [data]);

  const dropOffMap = useMemo(() => {
    const m = new Map<string, FunnelDropOffRow>();
    data?.dropOff.forEach((d) => m.set(d.stage, d));
    return m;
  }, [data]);

  const otherEvents = useMemo(() => {
    const stageNames = new Set(STAGE_ORDER.map((s) => s.name));
    const names = Array.from(stageMap.keys()).filter((n) => !stageNames.has(n));
    const known = Object.keys(OTHER_EVENT_LABELS);
    names.sort((a, b) => {
      const ai = known.indexOf(a);
      const bi = known.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
    return names;
  }, [stageMap]);

  if (loading && !data) {
    return <div className="flex justify-center py-12"><CircleNotch className="h-6 w-6 animate-spin text-gray-400 dark:text-gray-500" weight="bold" /></div>;
  }
  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-error mb-4">{error}</p>
        <Button variant="outline" size="sm" onClick={() => setRetryNonce((n) => n + 1)}>
          <ArrowsClockwise className="h-4 w-4 mr-2" weight="bold" />Retry
        </Button>
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold tracking-tight text-gray-900 dark:text-gray-100">Funnel</h2>
        <div className="flex gap-1.5">
          {(Object.keys(WINDOW_LABELS) as FunnelWindow[]).map((w) => (
            <Button key={w} size="sm" variant={w === win ? 'default' : 'outline'} onClick={() => setWin(w)}>
              {w === 'all' ? 'All' : w}
            </Button>
          ))}
        </div>
      </div>

      {/* Stages with drop-off */}
      <Card>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
            <ChartLineUp className="h-4 w-4" weight="bold" />
            <span className="text-[10px] font-bold uppercase tracking-wider">
              Stages · {WINDOW_LABELS[win]}
            </span>
          </div>
          <div className="space-y-3">
            {STAGE_ORDER.map((stage) => {
              const row = stageMap.get(stage.name);
              const drop = dropOffMap.get(stage.name);
              const sessions = row?.sessions ?? 0;
              const retainedFromStart = drop?.retainedFromStart ?? 0;
              // `retainedFromPrev` is the fraction of the previous
              // stage that reached this one — higher is better, so
              // <30% retained is red, 30-60% orange, 60%+ green.
              const retainedFromPrev = drop?.retainedFromPrev ?? null;
              const buckets = breakdownByEvent.get(stage.name) ?? [];
              return (
                <div key={stage.name} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold text-gray-900 dark:text-gray-100">{stage.label}</span>
                    <span className="flex items-center gap-2 tabular-nums">
                      <span className="text-gray-600 dark:text-gray-400">{sessions.toLocaleString()} sessions</span>
                      {retainedFromPrev !== null && (
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            retainedFromPrev < 0.3 ? 'bg-red-100 dark:bg-red-900/40 text-red-700'
                            : retainedFromPrev < 0.6 ? 'bg-orange-100 dark:bg-orange-900/40 text-orange-700'
                            : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400'
                          }`}
                          title="% of previous stage that made it to this stage"
                        >
                          {(retainedFromPrev * 100).toFixed(0)}% retained
                        </span>
                      )}
                      <span className="font-bold text-brand">
                        {(retainedFromStart * 100).toFixed(1)}% from start
                      </span>
                    </span>
                  </div>
                  <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded overflow-hidden">
                    <div className="h-full bg-brand transition-all" style={{ width: `${Math.min(100, retainedFromStart * 100)}%` }} />
                  </div>
                  {buckets.length > 1 && (
                    <div className="pl-3 pt-1 text-[11px] text-gray-500 dark:text-gray-400 flex flex-wrap gap-x-3 gap-y-0.5">
                      {buckets.map((b) => (
                        <span key={b.bucket} className="tabular-nums">
                          {b.bucket}: <span className="font-bold text-gray-700 dark:text-gray-300">{b.sessions}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Entry points */}
      <Card>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
            <Target className="h-4 w-4" weight="bold" />
            <span className="text-[10px] font-bold uppercase tracking-wider">
              Entry points — gate triggered by feature
            </span>
          </div>
          {data.entryPoints.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No gate events in this window.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="py-1 pr-2 text-left">Feature</th>
                  <th className="py-1 px-2 text-right">Shown</th>
                  <th className="py-1 px-2 text-right">Clicked</th>
                  <th className="py-1 px-2 text-right">Checkout started</th>
                  <th className="py-1 px-2 text-right">Completed</th>
                  <th className="py-1 pl-2 text-right">Convert %</th>
                </tr>
              </thead>
              <tbody>
                {data.entryPoints.map((ep) => (
                  <tr key={ep.feature} className="border-t border-gray-100 dark:border-gray-800">
                    <td className="py-1 pr-2 font-mono text-[12px]">{ep.feature}</td>
                    <td className="py-1 px-2 text-right tabular-nums">{ep.shown}</td>
                    <td className="py-1 px-2 text-right tabular-nums">{ep.clicked}</td>
                    <td className="py-1 px-2 text-right tabular-nums">{ep.checkoutStarted}</td>
                    <td className="py-1 px-2 text-right tabular-nums">{ep.checkoutCompleted}</td>
                    <td className="py-1 pl-2 text-right tabular-nums font-bold text-brand">
                      {(ep.convertedPct * 100).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Time to stage */}
      <Card>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
            <Timer className="h-4 w-4" weight="bold" />
            <span className="text-[10px] font-bold uppercase tracking-wider">
              Time to stage (medians)
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <TtsCell label="First play → profile" ms={data.timeToStage.firstPlayToProfile} />
            <TtsCell label="Profile → gate" ms={data.timeToStage.profileToGate} />
            <TtsCell label="Gate → upgrade click" ms={data.timeToStage.gateToUpgrade} />
            <TtsCell label="Upgrade → checkout" ms={data.timeToStage.upgradeToCheckout} />
          </div>
        </CardContent>
      </Card>

      {/* Other signals — events outside the canonical funnel */}
      {otherEvents.length > 0 && (
        <Card>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
              <ChartLineUp className="h-4 w-4" weight="bold" />
              <span className="text-[10px] font-bold uppercase tracking-wider">Other signals</span>
            </div>
            <div className="space-y-3">
              {otherEvents.map((name) => {
                const row = stageMap.get(name);
                if (!row) return null;
                const label = OTHER_EVENT_LABELS[name] ?? name;
                const buckets = breakdownByEvent.get(name) ?? [];
                return (
                  <div key={name} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-semibold text-gray-900 dark:text-gray-100">{label}</span>
                      <span className="tabular-nums text-gray-600 dark:text-gray-400">
                        {row.sessions.toLocaleString()} sessions
                        <span className="text-gray-400 dark:text-gray-500 ml-2">({row.total.toLocaleString()} events)</span>
                      </span>
                    </div>
                    {buckets.length > 0 && (
                      <div className="pl-3 pt-1 text-[11px] text-gray-500 dark:text-gray-400 flex flex-wrap gap-x-3 gap-y-0.5">
                        {buckets.map((b) => (
                          <span key={b.bucket} className="tabular-nums">
                            {b.bucket}: <span className="font-bold text-gray-700 dark:text-gray-300">{b.sessions}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Time-to-convert (existing, upgrade → checkout per method) */}
      <Card>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
            <Timer className="h-4 w-4" weight="bold" />
            <span className="text-[10px] font-bold uppercase tracking-wider">
              Median time · upgrade click → checkout complete (by method)
            </span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {data.stats.medianTimeToConvertMs.map((m) => (
              <div key={m.method}>
                <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">{m.method}</div>
                <div className="text-2xl font-black tabular-nums text-gray-900 dark:text-gray-100">
                  {m.ms == null ? '—' : formatMs(m.ms)}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TtsCell({ label, ms }: { label: string; ms: number | null }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">{label}</div>
      <div className="text-xl font-black tabular-nums text-gray-900 dark:text-gray-100">
        {ms == null ? '—' : formatMs(ms)}
      </div>
    </div>
  );
}
