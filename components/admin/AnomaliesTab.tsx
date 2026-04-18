'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatMs } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CircleNotch, ArrowsClockwise } from '@phosphor-icons/react';

interface AnomalyRow {
  id: number;
  puzzleId: number;
  dayNumber: number | null;
  wallet: string | null;
  sessionId: string;
  serverSolveMs: number | null;
  clientSolveMs: number | null;
  keystrokeStddevMs: number | null;
  keystrokeMinMs: number | null;
  keystrokeCount: number | null;
  flag: 'ineligible' | 'suspicious';
  createdAt: string;
  handle: string | null;
  avatarUrl: string | null;
}

/**
 * Anomalies tab — the same ~200-row flagged-solve table the old
 * `/admin/anomalies` page shipped, rebuilt on the new Card/Table
 * primitives and fetched client-side so a refresh button works
 * without a full route revalidation.
 *
 * Flag pills use the same tone conventions as the Pulse tab:
 * `ineligible` = error (hard bot), `suspicious` = warning (review).
 */
export function AnomaliesTab() {
  const [entries, setEntries] = useState<AnomalyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAnomalies = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/anomalies', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      const json = (await res.json()) as { entries: AnomalyRow[] };
      setEntries(json.entries ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAnomalies();
  }, [fetchAnomalies]);

  const moderateFlag = async (solveId: number, flag: 'ineligible' | 'suspicious' | null) => {
    try {
      const res = await fetch('/api/admin/anomalies', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ solveId, flag }),
      });
      if (!res.ok) return;
      // Optimistically update the local list — if flag is null (cleared),
      // remove the row; otherwise update it in place.
      if (flag === null) {
        setEntries((prev) => prev.filter((e) => e.id !== solveId));
      } else {
        setEntries((prev) => prev.map((e) => e.id === solveId ? { ...e, flag } : e));
      }
    } catch {/* best-effort */}
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Anomaly review</CardTitle>
          <CardDescription>
            {entries.length} flagged solves · ineligible + suspicious, newest first
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchAnomalies}
          disabled={loading}
        >
          {loading ? (
            <CircleNotch className="h-4 w-4 animate-spin" weight="bold" />
          ) : (
            <ArrowsClockwise className="h-4 w-4" weight="bold" />
          )}
        </Button>
      </CardHeader>
      <CardContent>
        {error ? (
          <div className="text-center py-8">
            <p className="text-sm text-error">{error}</p>
          </div>
        ) : loading && entries.length === 0 ? (
          <div className="flex justify-center py-12">
            <CircleNotch className="h-6 w-6 animate-spin text-gray-400" weight="bold" />
          </div>
        ) : entries.length === 0 ? (
          <p className="text-center text-sm text-gray-500 py-8">
            No flagged solves. Good news or quiet traffic.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Puzzle</TableHead>
                <TableHead>Flag</TableHead>
                <TableHead>Identity</TableHead>
                <TableHead className="text-right">Server</TableHead>
                <TableHead className="text-right">Client</TableHead>
                <TableHead className="text-right">Strokes</TableHead>
                <TableHead className="text-right">Stddev</TableHead>
                <TableHead className="text-right">Min</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-mono text-xs whitespace-nowrap">
                    {new Date(e.createdAt).toISOString().replace('T', ' ').slice(0, 19)}
                  </TableCell>
                  <TableCell className="tabular-nums font-semibold">
                    {e.dayNumber != null ? `#${e.dayNumber}` : '—'}
                  </TableCell>
                  <TableCell>
                    <FlagPill flag={e.flag} />
                  </TableCell>
                  <TableCell className="text-xs max-w-[200px]">
                    <div className="flex items-center gap-1.5">
                      {e.avatarUrl && (
                        <img src={e.avatarUrl} alt="" className="w-5 h-5 rounded-full object-cover flex-shrink-0" />
                      )}
                      <span className="font-mono truncate">
                        {e.handle
                          ? e.handle
                          : e.wallet
                            ? `${e.wallet.slice(0, 6)}\u2026${e.wallet.slice(-4)}`
                            : `anon:${e.sessionId.slice(0, 8)}`}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-mono text-xs">
                    {e.serverSolveMs != null ? formatMs(e.serverSolveMs) : '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-mono text-xs">
                    {e.clientSolveMs != null ? formatMs(e.clientSolveMs) : '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-mono text-xs">
                    {e.keystrokeCount ?? '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-mono text-xs">
                    {e.keystrokeStddevMs ?? '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-mono text-xs">
                    {e.keystrokeMinMs ?? '\u2014'}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {e.flag === 'ineligible' && (
                        <button
                          type="button"
                          onClick={() => moderateFlag(e.id, 'suspicious')}
                          className="text-[10px] font-semibold text-warning-700 hover:underline"
                          title="Downgrade to suspicious"
                        >
                          Suspicious
                        </button>
                      )}
                      {e.flag === 'suspicious' && (
                        <button
                          type="button"
                          onClick={() => moderateFlag(e.id, 'ineligible')}
                          className="text-[10px] font-semibold text-error-700 hover:underline"
                          title="Upgrade to ineligible"
                        >
                          Ineligible
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => moderateFlag(e.id, null)}
                        className="text-[10px] font-semibold text-green-700 hover:underline"
                        title="Clear flag (mark as legitimate)"
                      >
                        Clear
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function FlagPill({ flag }: { flag: 'ineligible' | 'suspicious' }) {
  const classes =
    flag === 'ineligible'
      ? 'bg-error-50 text-error-700 border-error-200'
      : 'bg-warning-50 text-warning-700 border-warning-200';
  return (
    <span
      className={`inline-flex items-center rounded-pill border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${classes}`}
    >
      {flag}
    </span>
  );
}
