'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CircleNotch, ArrowsClockwise, PuzzlePiece, Calendar, TrendUp, X, ClockCounterClockwise } from '@phosphor-icons/react';
import { formatMsCompact as formatMs, formatMsClock } from '@/lib/format';
import { ScatterCalibration, type CalibrationPoint } from './charts/ScatterCalibration';
import { SpoilerAnswer } from './SpoilerAnswer';

interface PuzzlesPayload {
  today: {
    puzzleId: number;
    dayNumber: number;
    date: string;
    answer: string;
    grid: string;
    heuristicScore: number;
    tier: string;
    solves: number;
    loads: number;
    starts: number;
    solveRate: number | null;
    avgServerMs: number | null;
    avgClientMs: number | null;
    wordmarksEarned: number;
    topCrumbs: Array<{ word: string; count: number }>;
  } | null;
  upcoming: Array<{ puzzleId: number; dayNumber: number; date: string; answer: string; heuristicScore: number; tier: string }>;
  past: Array<{ puzzleId: number; dayNumber: number; date: string; answer: string; solves: number; heuristicScore: number; tier: string }>;
  hardest: Array<{ puzzleId: number; dayNumber: number; date: string; answer: string; solves: number; avgMs: number; heuristicScore: number; tier: string }>;
  easiest: Array<{ puzzleId: number; dayNumber: number; date: string; answer: string; solves: number; avgMs: number; heuristicScore: number; tier: string }>;
  neverSolved: Array<{ puzzleId: number; dayNumber: number; date: string; answer: string }>;
  calibration: {
    points: Array<CalibrationPoint & { puzzleId: number; dayNumber: number }>;
    slope: number;
    intercept: number;
    rSquared: number;
    residualStdDev: number;
  };
}

const TIER_TONE: Record<string, string> = {
  Gentle: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300',
  Easy: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400',
  Medium: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-300',
  Hard: 'bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-300',
  Brutal: 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300',
};

/**
 * Puzzles tab — content-ops view. Four sections:
 *   1. Today: answer + grid + observed health + heuristic score
 *   2. Upcoming 10: pipeline preview annotated with heuristic scores
 *      so Jake can eyeball difficulty balance before ship
 *   3. Historical ranked by observed difficulty (hardest/easiest) +
 *      never-solved list
 *   4. Calibration scatter — heuristic × observed, with OLS fit +
 *      outliers list (> 1σ residual). This is the feedback loop
 *      for refining the heuristic formula.
 */
export function PuzzlesTab() {
  const [data, setData] = useState<PuzzlesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Answers the admin has explicitly chosen to reveal, keyed by puzzleId.
  // Default-hidden so the admin doesn’t see today/upcoming solutions by
  // accident — past answers are stale secrets, but still gated behind the
  // same click-to-reveal so the UI stays consistent and skimmable.
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const toggleReveal = useCallback((puzzleId: number) => {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(puzzleId)) next.delete(puzzleId);
      else next.add(puzzleId);
      return next;
    });
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/puzzles', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      setData(await res.json() as PuzzlesPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchData(); }, []);

  if (loading && !data) return <div className="flex justify-center py-12"><CircleNotch className="h-6 w-6 animate-spin text-gray-400 dark:text-gray-500" weight="bold" /></div>;
  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-error mb-4">{error}</p>
        <Button variant="outline" size="sm" onClick={fetchData}><ArrowsClockwise className="h-4 w-4 mr-2" weight="bold" />Retry</Button>
      </div>
    );
  }
  if (!data) return null;

  const outliers = data.calibration.residualStdDev > 0
    ? data.calibration.points
        .map((p) => ({ ...p, z: Math.abs(p.residual) / data.calibration.residualStdDev }))
        .filter((p) => p.z > 1)
        .sort((a, b) => b.z - a.z)
        .slice(0, 8)
    : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold tracking-tight text-gray-900 dark:text-gray-100">Puzzles</h2>
        <Button variant="ghost" size="sm" onClick={fetchData} aria-label="Refresh">
          <ArrowsClockwise className="h-4 w-4" weight="bold" />
        </Button>
      </div>

      {/* Today */}
      {data.today && (
        <Card>
          <CardHeader><CardTitle className="text-sm flex items-center gap-1.5"><PuzzlePiece className="w-4 h-4" weight="bold" />Today</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">Answer</div>
              <SpoilerAnswer
                answer={data.today.answer}
                revealed={revealed.has(data.today.puzzleId)}
                onToggle={() => toggleReveal(data.today!.puzzleId)}
                size="lg"
              />
              <div className="font-mono text-[11px] text-gray-500 dark:text-gray-400 mt-1">day #{data.today.dayNumber} · {data.today.date}</div>
              <div className="mt-2 flex items-center gap-2 text-[11px]">
                <span className={`rounded px-1.5 py-0.5 font-bold ${TIER_TONE[data.today.tier] ?? 'bg-gray-100 dark:bg-gray-800'}`}>{data.today.tier}</span>
                <span className="text-gray-500 dark:text-gray-400">heuristic {data.today.heuristicScore}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Metric label="Solves" value={data.today.solves.toLocaleString()} />
              <Metric label="Solve rate" value={data.today.solveRate != null ? `${(data.today.solveRate * 100).toFixed(0)}%` : '—'} sub={`${data.today.starts} starts / ${data.today.loads} loads`} />
              <Metric label="Avg solve" value={data.today.avgServerMs ? formatMsClock(data.today.avgServerMs) : '—'} sub={data.today.avgClientMs ? `client ${formatMsClock(data.today.avgClientMs)}` : undefined} />
              <Metric label="Wordmarks" value={data.today.wordmarksEarned.toLocaleString()} />
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">Top crumbs found</div>
              {data.today.topCrumbs.length === 0 ? (
                <p className="text-[12px] text-gray-400 dark:text-gray-500">No crumbs yet.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {data.today.topCrumbs.map((c) => (
                    <li key={c.word} className="flex justify-between">
                      <span className="font-mono">{c.word}</span>
                      <span className="tabular-nums text-gray-500 dark:text-gray-400">×{c.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Upcoming */}
      <Card>
        <CardHeader><CardTitle className="text-sm flex items-center gap-1.5"><Calendar className="w-4 h-4" weight="bold" />Upcoming</CardTitle></CardHeader>
        <CardContent>
          {data.upcoming.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No upcoming puzzles queued.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                <tr><th className="py-1 pr-2 text-left">Day</th><th className="py-1 px-2 text-left">Date</th><th className="py-1 px-2 text-left">Answer</th><th className="py-1 px-2 text-right">Heuristic</th><th className="py-1 pl-2 text-right">Tier</th></tr>
              </thead>
              <tbody>
                {data.upcoming.map((p) => (
                  <tr key={p.puzzleId} className="border-t border-gray-100 dark:border-gray-800">
                    <td className="py-1 pr-2 tabular-nums">#{p.dayNumber}</td>
                    <td className="py-1 px-2 font-mono text-[11px] text-gray-500 dark:text-gray-400">{p.date}</td>
                    <td className="py-1 px-2">
                      <SpoilerAnswer
                        answer={p.answer}
                        revealed={revealed.has(p.puzzleId)}
                        onToggle={() => toggleReveal(p.puzzleId)}
                        size="sm"
                      />
                    </td>
                    <td className="py-1 px-2 text-right tabular-nums">{p.heuristicScore}</td>
                    <td className="py-1 pl-2 text-right"><span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${TIER_TONE[p.tier] ?? 'bg-gray-100 dark:bg-gray-800'}`}>{p.tier}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Past */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-1.5">
            <ClockCounterClockwise className="w-4 h-4" weight="bold" />Past
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.past.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No past puzzles yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="py-1 pr-2 text-left">Day</th>
                  <th className="py-1 px-2 text-left">Date</th>
                  <th className="py-1 px-2 text-left">Answer</th>
                  <th className="py-1 px-2 text-right">Solves</th>
                  <th className="py-1 px-2 text-right">Heuristic</th>
                  <th className="py-1 pl-2 text-right">Tier</th>
                </tr>
              </thead>
              <tbody>
                {data.past.map((p) => (
                  <tr key={p.puzzleId} className="border-t border-gray-100 dark:border-gray-800">
                    <td className="py-1 pr-2 tabular-nums">#{p.dayNumber}</td>
                    <td className="py-1 px-2 font-mono text-[11px] text-gray-500 dark:text-gray-400">{p.date}</td>
                    <td className="py-1 px-2 font-mono tracking-wider text-gray-800 dark:text-gray-200">{p.answer}</td>
                    <td className="py-1 px-2 text-right tabular-nums">{p.solves.toLocaleString()}</td>
                    <td className="py-1 px-2 text-right tabular-nums">{p.heuristicScore}</td>
                    <td className="py-1 pl-2 text-right">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${TIER_TONE[p.tier] ?? 'bg-gray-100 dark:bg-gray-800'}`}>{p.tier}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Historical */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DifficultyList title="Hardest 20 (by avg solve time)" rows={data.hardest} />
        <DifficultyList title="Easiest 20" rows={data.easiest} />
      </div>

      {data.neverSolved.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm flex items-center gap-1.5"><X className="w-4 h-4" weight="bold" />Never solved · last 50</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {data.neverSolved.map((p) => (
                <span key={p.puzzleId} className="text-[11px] font-mono rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 px-1.5 py-0.5">
                  #{p.dayNumber}:{p.answer}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Calibration */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-1.5"><TrendUp className="w-4 h-4" weight="bold" />Calibration · heuristic vs observed</CardTitle>
        </CardHeader>
        <CardContent>
          <ScatterCalibration points={data.calibration.points} slope={data.calibration.slope} intercept={data.calibration.intercept} />
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-3">
            OLS fit: observed_ms = {data.calibration.slope.toFixed(0)} × heuristic + {data.calibration.intercept.toFixed(0)}
            {' · '}
            R² = {data.calibration.rSquared.toFixed(2)}
            {' · '}
            σ = {(data.calibration.residualStdDev / 1000).toFixed(1)}s
          </p>

          {outliers.length > 0 && (
            <div className="mt-4">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">Outliers (|z| &gt; 1)</h4>
              <table className="w-full text-[12px]">
                <thead className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  <tr><th className="py-1 pr-2 text-left">Answer</th><th className="py-1 px-2 text-right">Heuristic</th><th className="py-1 px-2 text-right">Observed</th><th className="py-1 px-2 text-right">Predicted</th><th className="py-1 pl-2 text-right">Residual</th></tr>
                </thead>
                <tbody>
                  {outliers.map((p) => {
                    const predicted = data.calibration.slope * p.heuristic + data.calibration.intercept;
                    return (
                      <tr key={p.puzzleId} className="border-t border-gray-100 dark:border-gray-800">
                        <td className="py-1 pr-2 font-mono tracking-wider">{p.answer}</td>
                        <td className="py-1 px-2 text-right tabular-nums">{p.heuristic}</td>
                        <td className="py-1 px-2 text-right tabular-nums">{formatMs(p.observedAvgMs)}</td>
                        <td className="py-1 px-2 text-right tabular-nums text-gray-500 dark:text-gray-400">{formatMs(predicted)}</td>
                        <td className={`py-1 pl-2 text-right tabular-nums font-bold ${p.residual > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                          {formatSignedMs(p.residual)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-2">
                Positive residual = observed slower than predicted (heuristic underestimated difficulty).
                Negative = observed faster (heuristic overestimated). Use this to retune the formula.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Signed wrapper around `formatMsCompact` for calibration residuals.
 * A residual of −12000 ms means "observed 12s faster than predicted"
 * and must retain its sign for the outlier table to be legible.
 *
 * `formatMsCompact` takes `Math.abs(ms)` internally — that's the only
 * reason a naïve prefix works here without producing `--12.0s`. If
 * `formatMsCompact`'s sign-stripping behavior ever changes, this
 * function needs updating to match.
 */
function formatSignedMs(ms: number): string {
  if (ms === 0) return formatMs(0); // '0ms' reads better than '+0ms'
  const sign = ms > 0 ? '+' : '-';
  // Explicit Math.abs so we don't silently depend on formatMsCompact
  // stripping the sign internally — if that implementation detail ever
  // flips, this call site still emits a single correct prefix.
  return `${sign}${formatMs(Math.abs(ms))}`;
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">{label}</div>
      <div className="text-xl font-black tabular-nums text-gray-900 dark:text-gray-100">{value}</div>
      {sub && <div className="text-[10px] text-gray-400 dark:text-gray-500">{sub}</div>}
    </div>
  );
}

function DifficultyList({ title, rows }: {
  title: string;
  rows: Array<{ puzzleId: number; dayNumber: number; date: string; answer: string; solves: number; avgMs: number; heuristicScore: number; tier: string }>;
}) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Not enough solve data yet (min 10 per puzzle).</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              <tr>
                <th className="py-1 pr-2 text-left">Day</th>
                <th className="py-1 px-2 text-left">Answer</th>
                <th className="py-1 px-2 text-right">Solves</th>
                <th className="py-1 px-2 text-right">Avg solve</th>
                <th className="py-1 pl-2 text-right">Heuristic</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.puzzleId} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="py-1 pr-2 tabular-nums text-gray-600 dark:text-gray-400">#{r.dayNumber}</td>
                  <td className="py-1 px-2 font-mono tracking-wider text-gray-800 dark:text-gray-200">{r.answer}</td>
                  <td className="py-1 px-2 text-right tabular-nums">{r.solves}</td>
                  <td className="py-1 px-2 text-right tabular-nums font-bold">{formatMsClock(r.avgMs)}</td>
                  <td className="py-1 pl-2 text-right tabular-nums">{r.heuristicScore}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
