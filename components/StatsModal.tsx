'use client';

import { useEffect, useState } from 'react';
import { formatMs } from '@/lib/format';

interface WalletStats {
  totalSolves: number;
  unassistedSolves: number;
  fastestMs: number | null;
  averageMs: number | null;
  currentStreak: number;
  longestStreak: number;
}

interface StatsResponse {
  wallet: string | null;
  stats?: WalletStats;
}

interface StatsModalProps {
  open: boolean;
  onClose: () => void;
  onConnect: () => void;
  /** Farcaster profile picture URL if authed inside a miniapp container. */
  pfpUrl: string | null;
  /** Display name to render next to the avatar — falls back to a truncated wallet. */
  displayName: string | null;
}

/**
 * Stats modal — opened by the Stats tile. Fetches aggregate stats for
 * the session's bound wallet on mount. Four states:
 *
 *   - loading     → spinner placeholders
 *   - no-wallet   → Connect CTA (button defers to the parent's connect flow)
 *   - zero-solves → friendly empty state (wallet is bound but no eligible solves yet)
 *   - loaded      → six-cell stats grid
 *
 * The avatar is the user's Farcaster pfpUrl when running inside a miniapp,
 * otherwise a monogram derived from the connected wallet address.
 */
export function StatsModal({
  open,
  onClose,
  onConnect,
  pfpUrl,
  displayName,
}: StatsModalProps) {
  // Default to loading=true + data=null so the first paint of a fresh
  // open renders the skeleton, not the no-wallet CTA. The previous
  // (loading=false, data=null) default produced a one-frame flash of
  // "Connect wallet" before the useEffect switched into loading — and
  // on reopen, stale `data` from the previous fetch would flash for
  // one frame. Resetting both in the effect on every open keeps the
  // render deterministic across repeated opens.
  const [data, setData] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setData(null);
    fetch('/api/stats')
      .then((r) => (r.ok ? r.json() : null))
      .then((j: StatsResponse | null) => {
        if (cancelled) return;
        setData(j);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setData(null);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const wallet = data?.wallet ?? null;
  const stats = data?.stats;
  const monogram = wallet ? wallet.slice(2, 3).toUpperCase() : '?';
  const label = displayName ?? (wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : 'Anonymous');

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="modal-sheet sm:rounded-card animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <Avatar pfpUrl={pfpUrl} monogram={monogram} />
          <div className="min-w-0">
            <h2 className="text-lg font-black tracking-tight text-gray-900 truncate">
              {label}
            </h2>
            <p className="text-xs font-medium text-gray-500">Your Griddle stats</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close stats"
            className="ml-auto w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors duration-fast"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              className="w-4 h-4"
              aria-hidden
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="mt-5">
          {loading ? (
            <StatsSkeleton />
          ) : !wallet ? (
            <NoWalletState onConnect={onConnect} />
          ) : !stats || stats.totalSolves === 0 ? (
            <EmptyState />
          ) : (
            <StatsGrid stats={stats} />
          )}
        </div>
      </div>
    </div>
  );
}

function Avatar({ pfpUrl, monogram }: { pfpUrl: string | null; monogram: string }) {
  if (pfpUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={pfpUrl}
        alt=""
        className="w-11 h-11 rounded-full bg-gray-100 object-cover flex-shrink-0"
      />
    );
  }
  return (
    <div className="w-11 h-11 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-black text-lg flex-shrink-0">
      {monogram}
    </div>
  );
}

function StatsSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-16 rounded-md bg-gray-100 animate-pulse" />
      ))}
    </div>
  );
}

function NoWalletState({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="py-6 text-center">
      <p className="text-sm text-gray-700 leading-relaxed">
        Connect a wallet to track your streaks and fastest times.
      </p>
      <button type="button" onClick={onConnect} className="btn-primary w-full mt-5">
        Connect wallet
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="py-6 text-center">
      <p className="text-sm text-gray-700 leading-relaxed">
        No solves yet. Today’s puzzle is waiting for you.
      </p>
    </div>
  );
}

function StatsGrid({ stats }: { stats: WalletStats }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <StatCell label="Solves" value={stats.totalSolves.toString()} />
      <StatCell label="Unassisted" value={stats.unassistedSolves.toString()} />
      <StatCell
        label="Current"
        value={stats.currentStreak > 0 ? `${stats.currentStreak}🔥` : '0'}
      />
      <StatCell label="Longest" value={stats.longestStreak.toString()} />
      <StatCell
        label="Fastest"
        value={stats.fastestMs != null ? formatMs(stats.fastestMs) : '—'}
      />
      <StatCell
        label="Average"
        value={stats.averageMs != null ? formatMs(stats.averageMs) : '—'}
      />
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-md p-3 text-center">
      <div className="text-base font-black text-gray-900 tabular-nums">{value}</div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mt-0.5">
        {label}
      </div>
    </div>
  );
}
