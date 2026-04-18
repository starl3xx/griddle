'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export interface CohortCell {
  cohortWeek: string;
  size: number;
  w1Pct: number;
  w2Pct: number;
  w4Pct: number;
  w8Pct: number;
}

/**
 * Cohort-retention heatmap. Rows = cohort weeks (newest first), cols
 * = W0/W1/W2/W4/W8 retention percentages. Color intensity scales
 * with retention %, calibrated so "good" hits the 500-weight band.
 *
 * Pure CSS grid + Tailwind; no Recharts (rendering colored cells is
 * faster and more legible than a charting lib for a 12x5 matrix).
 */
export function CohortHeatmap({ cohorts }: { cohorts: CohortCell[] }) {
  if (cohorts.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">No cohort data yet.</p>;
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Weekly cohorts</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-gray-500 dark:text-gray-400">
                <th className="py-1 pr-3 text-left font-bold uppercase tracking-wider">Cohort</th>
                <th className="py-1 px-2 text-right font-bold uppercase tracking-wider">Size</th>
                {['W1', 'W2', 'W4', 'W8'].map((col) => (
                  <th key={col} className="py-1 px-2 text-center font-bold uppercase tracking-wider">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cohorts.map((c) => (
                <tr key={c.cohortWeek} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="py-1 pr-3 font-mono text-[11px] text-gray-700 dark:text-gray-300">{c.cohortWeek}</td>
                  <td className="py-1 px-2 text-right tabular-nums">{c.size.toLocaleString()}</td>
                  <HeatCell pct={c.w1Pct} />
                  <HeatCell pct={c.w2Pct} />
                  <HeatCell pct={c.w4Pct} />
                  <HeatCell pct={c.w8Pct} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[10px] text-gray-400 dark:text-gray-500">
          Retention = % of cohort with any solve in that week-window. Session-based:
          clearing cookies looks like a new cohort, so these numbers are a floor.
        </p>
      </CardContent>
    </Card>
  );
}

function HeatCell({ pct }: { pct: number }) {
  // Bucket pct into color intensity. 0% = plain; 50%+ = strong.
  const bg =
    pct >= 0.5 ? 'bg-emerald-500 text-white'
    : pct >= 0.3 ? 'bg-emerald-300 text-emerald-900'
    : pct >= 0.15 ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300'
    : pct > 0 ? 'bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
    : 'bg-gray-50 dark:bg-gray-800 text-gray-300 dark:text-gray-600';
  return (
    <td className="py-1 px-2 text-center tabular-nums">
      <span className={`inline-block w-full rounded-sm px-1.5 py-0.5 font-medium ${bg}`}>
        {pct > 0 ? `${Math.round(pct * 100)}%` : '—'}
      </span>
    </td>
  );
}
