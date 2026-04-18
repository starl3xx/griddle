'use client';

import { useEffect, useState } from 'react';
import { CircleNotch, MagnifyingGlass, ArrowSquareOut } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatPlayerName } from '@/lib/format';

type SourceFilter = 'all' | 'crypto' | 'fiat' | 'admin_grant' | 'pending' | 'refunded';

interface TxRow {
  wallet: string;
  handle: string | null;
  source: string;
  txHash: string | null;
  stripeSessionId: string | null;
  usdcAmount: string | null;
  wordBurned: string | null;
  escrowStatus: 'pending' | 'burned' | 'refunded' | null;
  escrowOpenTx: string | null;
  escrowBurnTx: string | null;
  externalId: string | null;
  unlockedAt: string;
  grantedBy: string | null;
  reason: string | null;
}

interface TxResponse {
  rows: TxRow[];
  pagination: { page: number; limit: number; total: number; pages: number };
}

const BASESCAN_TX = 'https://basescan.org/tx/';

/**
 * Admin Transactions tab — the flat ledger of every premium payment:
 * crypto USDC swaps, fiat escrows (pending / burned / refunded), and
 * admin grants. One row per `premium_users` row, sorted newest-first.
 *
 * Filter chips group the common ops questions: "who's pending", "who
 * charged back", "how many crypto unlocks today". Search narrows by
 * wallet prefix or handle.
 */
export function TransactionsTab() {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [filter, setFilter] = useState<SourceFilter>('all');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<TxResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    setPage(1);
  }, [debouncedQuery, filter]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      filter,
      page: String(page),
      limit: '50',
    });
    if (debouncedQuery.trim()) params.set('q', debouncedQuery.trim());

    fetch(`/api/admin/transactions?${params.toString()}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as TxResponse;
      })
      .then((resp) => {
        if (!cancelled) setData(resp);
      })
      .catch((err) => {
        if (cancelled) return;
        if ((err as Error).name !== 'AbortError') {
          setError((err as Error).message);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [debouncedQuery, filter, page]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <MagnifyingGlass
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-gray-500"
            weight="bold"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search wallet or handle…"
            className="pl-9"
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          <FilterChip label="All" value="all" active={filter} setActive={setFilter} />
          <FilterChip label="Crypto" value="crypto" active={filter} setActive={setFilter} />
          <FilterChip label="Fiat" value="fiat" active={filter} setActive={setFilter} />
          <FilterChip label="Pending" value="pending" active={filter} setActive={setFilter} />
          <FilterChip label="Refunded" value="refunded" active={filter} setActive={setFilter} />
          <FilterChip label="Grants" value="admin_grant" active={filter} setActive={setFilter} />
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm px-3 py-2">
          {error}
        </div>
      )}

      <div className="relative overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Player</TableHead>
              <TableHead>Source</TableHead>
              <TableHead className="text-right">USDC</TableHead>
              <TableHead className="text-right">$WORD burned</TableHead>
              <TableHead>Escrow</TableHead>
              <TableHead>Unlocked</TableHead>
              <TableHead>Links</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && !data ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8">
                  <CircleNotch className="inline h-4 w-4 animate-spin text-gray-400 dark:text-gray-500" weight="bold" />
                </TableCell>
              </TableRow>
            ) : data && data.rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-sm text-gray-500 dark:text-gray-400">
                  No transactions match.
                </TableCell>
              </TableRow>
            ) : (
              data?.rows.map((row) => (
                <TableRow key={`${row.wallet}-${row.unlockedAt}`}>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium text-gray-900 dark:text-gray-100">
                        {formatPlayerName({ handle: row.handle, wallet: row.wallet })}
                      </span>
                      <span className="font-mono text-[11px] text-gray-500 dark:text-gray-400">
                        {shortWallet(row.wallet)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <SourceBadge source={row.source} />
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {formatUsdcDisplay(row.usdcAmount)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {formatWordDisplay(row.wordBurned)}
                  </TableCell>
                  <TableCell>
                    <EscrowPill status={row.escrowStatus} source={row.source} />
                  </TableCell>
                  <TableCell className="text-sm text-gray-600 dark:text-gray-400">
                    {formatDate(row.unlockedAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {row.txHash && <TxLink hash={row.txHash} label="tx" />}
                      {row.escrowOpenTx && <TxLink hash={row.escrowOpenTx} label="open" />}
                      {row.escrowBurnTx && <TxLink hash={row.escrowBurnTx} label="settle" />}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {data && data.pagination.pages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
          <div>
            Page {data.pagination.page} of {data.pagination.pages} · {data.pagination.total} rows
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
            >
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= data.pagination.pages || loading}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterChip({
  label,
  value,
  active,
  setActive,
}: {
  label: string;
  value: SourceFilter;
  active: SourceFilter;
  setActive: (v: SourceFilter) => void;
}) {
  return (
    <Button
      variant={active === value ? 'default' : 'outline'}
      size="sm"
      onClick={() => setActive(value)}
    >
      {label}
    </Button>
  );
}

function SourceBadge({ source }: { source: string }) {
  const style = (() => {
    switch (source) {
      case 'crypto':
        return 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800';
      case 'fiat':
        return 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800';
      case 'admin_grant':
        return 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800';
      default:
        return 'bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700';
    }
  })();
  return (
    <span className={`inline-flex text-xs font-medium px-2 py-0.5 rounded-full border ${style}`}>
      {source}
    </span>
  );
}

function EscrowPill({
  status,
  source,
}: {
  status: 'pending' | 'burned' | 'refunded' | null;
  source: string;
}) {
  if (source === 'crypto') {
    return <span className="text-xs text-gray-500 dark:text-gray-400">burned on unlock</span>;
  }
  if (source === 'admin_grant') {
    return <span className="text-xs text-gray-500 dark:text-gray-400">n/a</span>;
  }
  if (!status) {
    return <span className="text-xs text-gray-400 dark:text-gray-500">—</span>;
  }
  const style =
    status === 'pending'
      ? 'bg-yellow-50 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800'
      : status === 'burned'
      ? 'bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700'
      : 'bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800';
  return (
    <span className={`inline-flex text-xs font-medium px-2 py-0.5 rounded-full border ${style}`}>
      {status}
    </span>
  );
}

function TxLink({ hash, label }: { hash: string; label: string }) {
  return (
    <a
      href={`${BASESCAN_TX}${hash}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-0.5 text-xs text-blue-700 dark:text-blue-400 hover:underline"
    >
      {label}
      <ArrowSquareOut className="h-3 w-3" weight="bold" aria-hidden />
    </a>
  );
}

function shortWallet(wallet: string): string {
  if (!wallet) return '';
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
}

function formatUsdcDisplay(value: string | null): string {
  if (!value) return '—';
  const num = Number(value);
  if (!Number.isFinite(num)) return value;
  return `$${num.toFixed(2)}`;
}

function formatWordDisplay(value: string | null): string {
  if (!value) return '—';
  try {
    const wei = BigInt(value);
    const whole = wei / 10n ** 18n;
    // Render with thousands separators; decimals trimmed since display
    // precision past whole tokens is noise at typical $WORD amounts.
    return whole.toLocaleString();
  } catch {
    return value;
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
