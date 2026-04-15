'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CircleNotch, ArrowsClockwise, ChartLineUp, Timer } from '@phosphor-icons/react';

type FunnelWindow = '24h' | '7d' | '30d' | 'all';

interface StageRow { eventName: string; sessions: number; total: number }
interface BreakdownRow { eventName: string; bucket: string; sessions: number; total: number }

interface FunnelStats {
  window: FunnelWindow;
  stages: StageRow[];
  breakdown: BreakdownRow[];
  medianTimeToConvertMs: { method: 'crypto' | 'fiat'; ms: number | null }[];
}

// The canonical funnel order. Events not in this list still render
// below the funnel as "other" — rare, but useful for spotting
// instrumentation drift.
const STAGE_ORDER: { name: string; label: string }[] = [
  { name: 'stats_opened',       label: 'Stats opened' },
  { name: 'premium_gate_shown', label: 'Premium gate shown' },
  { name: 'upgrade_clicked',    label: 'Upgrade clicked' },
  { name: 'checkout_started',   label: 'Checkout started' },
  { name: 'checkout_completed', label: 'Checkout completed' },
];

const WINDOW_LABELS: Record<FunnelWindow, string> = {
  '24h': '24 hours',
  '7d':  '7 days',
  '30d': '30 days',
  'all': 'All time',
};

export function FunnelTab() {
  const [win, setWin] = useState<FunnelWindow>('7d');
  const [data, setData] = useState<FunnelStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bumped by the retry button to force a re-fetch without changing
  // any other state. `setWin(win)` wouldn't re-run the effect because
  // React bails out when the new state equals the old.
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
        setData(await res.json() as FunnelStats);
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
    const m = new Map<string, StageRow>();
    data?.stages.forEach((s) => m.set(s.eventName, s));
    return m;
  }, [data]);

  const breakdownByEvent = useMemo(() => {
    const m = new Map<string, BreakdownRow[]>();
    data?.breakdown.forEach((b) => {
      const list = m.get(b.eventName) ?? [];
      list.push(b);
      m.set(b.eventName, list);
    });
    // Within each event sort by sessions desc so the dominant variant leads.
    m.forEach((list) => list.sort((a, b) => b.sessions - a.sessions));
    return m;
  }, [data]);

  // Baseline for conversion % = the first stage in the canonical list
  // that actually has data. Using the literal first stage would make
  // everything look 0% when instrumentation is still warming up.
  const baselineSessions = useMemo(() => {
    for (const s of STAGE_ORDER) {
      const row = stageMap.get(s.name);
      if (row && row.sessions > 0) return row.sessions;
    }
    return 0;
  }, [stageMap]);

  if (loading && !data) {
    return (
      <div className="flex justify-center py-12">
        <CircleNotch className="h-6 w-6 animate-spin text-gray-400" weight="bold" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-error mb-4">{error}</p>
        <Button variant="outline" size="sm" onClick={() => setRetryNonce((n) => n + 1)}>
          <ArrowsClockwise className="h-4 w-4 mr-2" weight="bold" />
          Retry
        </Button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-black tracking-tight text-gray-900">Funnel</h2>
        <div className="flex gap-1.5">
          {(Object.keys(WINDOW_LABELS) as FunnelWindow[]).map((w) => (
            <Button
              key={w}
              size="sm"
              variant={w === win ? 'default' : 'outline'}
              onClick={() => setWin(w)}
            >
              {w === 'all' ? 'All' : w}
            </Button>
          ))}
        </div>
      </div>

      {/* Stages */}
      <Card>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 text-gray-500">
            <ChartLineUp className="h-4 w-4" weight="bold" />
            <span className="text-[10px] font-bold uppercase tracking-wider">
              Stages · {WINDOW_LABELS[win]}
            </span>
          </div>
          <div className="space-y-2">
            {STAGE_ORDER.map((stage) => {
              const row = stageMap.get(stage.name);
              const sessions = row?.sessions ?? 0;
              const pct = baselineSessions > 0 ? (sessions / baselineSessions) * 100 : 0;
              const buckets = breakdownByEvent.get(stage.name) ?? [];
              return (
                <div key={stage.name} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold text-gray-900">{stage.label}</span>
                    <span className="tabular-nums text-gray-600">
                      {sessions.toLocaleString()} sessions
                      <span className="text-gray-400 ml-2">
                        ({(row?.total ?? 0).toLocaleString()} events)
                      </span>
                      {baselineSessions > 0 && (
                        <span className="ml-2 font-bold text-brand">
                          {pct.toFixed(1)}%
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded overflow-hidden">
                    <div
                      className="h-full bg-brand transition-all"
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                  {buckets.length > 1 && (
                    <div className="pl-3 pt-1 text-[11px] text-gray-500 flex flex-wrap gap-x-3 gap-y-0.5">
                      {buckets.map((b) => (
                        <span key={b.bucket} className="tabular-nums">
                          {b.bucket}: <span className="font-bold text-gray-700">{b.sessions}</span>
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

      {/* Time-to-convert */}
      <Card>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 text-gray-500">
            <Timer className="h-4 w-4" weight="bold" />
            <span className="text-[10px] font-bold uppercase tracking-wider">
              Median time · upgrade click → checkout complete
            </span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {data.medianTimeToConvertMs.map((m) => (
              <div key={m.method}>
                <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                  {m.method}
                </div>
                <div className="text-2xl font-black tabular-nums text-gray-900">
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

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}
