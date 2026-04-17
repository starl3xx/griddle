'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CircleNotch, ArrowsClockwise, UserCircle } from '@phosphor-icons/react';
import { CohortHeatmap, type CohortCell } from './charts/CohortHeatmap';

interface RetentionPayload {
  cohorts: CohortCell[];
}

/**
 * Retention tab — weekly cohort heatmap with a D1/D7/D30-style
 * summary strip at the top. Cohorts are keyed on session_id's first
 * solve, since session_id is the only identity guaranteed to exist
 * on first play. This floors retention (cleared cookies look like a
 * fresh session) — copy on the heatmap calls that caveat out.
 */
export function RetentionTab() {
  const [data, setData] = useState<RetentionPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/retention?weeks=12', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      setData(await res.json() as RetentionPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchData(); }, []);

  if (loading && !data) return <div className="flex justify-center py-12"><CircleNotch className="h-6 w-6 animate-spin text-gray-400" weight="bold" /></div>;
  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-error mb-4">{error}</p>
        <Button variant="outline" size="sm" onClick={fetchData}><ArrowsClockwise className="h-4 w-4 mr-2" weight="bold" />Retry</Button>
      </div>
    );
  }
  if (!data) return null;

  // Averages across cohorts where data is available (cohort size > 0).
  // A zero-size cohort would drop to 0% and skew the average.
  const withData = data.cohorts.filter((c) => c.size > 0);
  const avg = (pick: (c: CohortCell) => number) =>
    withData.length === 0 ? 0 : withData.reduce((a, c) => a + pick(c), 0) / withData.length;
  const avgW1 = avg((c) => c.w1Pct);
  const avgW2 = avg((c) => c.w2Pct);
  const avgW4 = avg((c) => c.w4Pct);
  const totalPlayers = withData.reduce((a, c) => a + c.size, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold tracking-tight text-gray-900">Retention</h2>
        <Button variant="ghost" size="sm" onClick={fetchData} aria-label="Refresh">
          <ArrowsClockwise className="h-4 w-4" weight="bold" />
        </Button>
      </div>

      <Card>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat icon={<UserCircle className="w-4 h-4" weight="bold" />} label="Players in window" value={totalPlayers.toLocaleString()} />
          <Stat icon={<UserCircle className="w-4 h-4" weight="bold" />} label="Avg W1 return" value={`${(avgW1 * 100).toFixed(1)}%`} tone="accent" />
          <Stat icon={<UserCircle className="w-4 h-4" weight="bold" />} label="Avg W2 return" value={`${(avgW2 * 100).toFixed(1)}%`} tone="accent" />
          <Stat icon={<UserCircle className="w-4 h-4" weight="bold" />} label="Avg W4 return" value={`${(avgW4 * 100).toFixed(1)}%`} tone="accent" />
        </CardContent>
      </Card>

      <CohortHeatmap cohorts={data.cohorts} />
    </div>
  );
}

function Stat({ icon, label, value, tone = 'ok' }: { icon: React.ReactNode; label: string; value: string; tone?: 'ok' | 'accent' }) {
  const valueClass = tone === 'accent' ? 'text-accent-700' : 'text-gray-900';
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-gray-400">
        {icon}
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{label}</span>
      </div>
      <div className={`text-3xl font-black tabular-nums ${valueClass}`}>{value}</div>
    </div>
  );
}
