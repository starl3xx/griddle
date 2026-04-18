'use client';

import { useEffect, useState } from 'react';
import { formatMs } from '@/lib/format';
import { Avatar } from '../Avatar';
import { LexiconGrid } from './LexiconGrid';
import { PremiumStatsSection } from './PremiumStatsSection';
import type { WalletStats } from '@/lib/db/queries';

interface StatsResponse {
  wallet: string | null;
  stats?: WalletStats;
}

interface StatsPanelProps {
  premium: boolean;
  /**
   * True when a session-profile KV binding exists (email/handle-only
   * profile created without wallet). Used to decide between the
   * anonymous CTA and the account stats view.
   */
  hasSessionProfile: boolean;
  /** True once the initial profile fetch has resolved (even if null). */
  profileLoaded: boolean;
  pfpUrl: string | null;
  /** User's display name from the bound profile (or Farcaster fallback). */
  username: string | null;
  /** Fires when an anonymous user taps the Sign in CTA. */
  onCreateProfile: () => void;
  /** Opens the premium gate modal. */
  onUpgrade: () => void;
  /**
   * BrowseModal close handler. We render a close button in this panel's
   * header so each tab feels standalone even though they share a shell.
   */
  onClose: () => void;
}

/**
 * Stats tab content — read-only dashboard view of the user's solve
 * data and Wordmarks.
 *
 * Three states based on identity + premium:
 *
 *   1. **Anonymous** — no wallet, no session profile. Shows a single
 *      Sign-in CTA. No connect-wallet or unlock-premium buttons —
 *      those live in Settings so Stats stays focused on the dashboard.
 *   2. **Account (free)** — profile exists, no premium. Shows stats
 *      grid + a post-profile upsell strip.
 *   3. **Premium** — full stats grid + Wordmarks placeholder.
 *
 * Previously this logic lived in a standalone StatsModal. BrowseModal
 * now hosts it as the Stats tab body — identical rendering, minus the
 * outer modal chrome which moves up to BrowseModal.
 */
export function StatsPanel({
  premium,
  hasSessionProfile,
  profileLoaded,
  pfpUrl,
  username,
  onCreateProfile,
  onUpgrade,
  onClose,
}: StatsPanelProps) {
  const [statsData, setStatsData] = useState<StatsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setStatsLoading(true);
    setStatsData(null);

    fetch('/api/stats')
      .then((r) => (r.ok ? r.json() : null))
      .then((j: StatsResponse | null) => {
        if (!cancelled) {
          setStatsData(j);
          setStatsLoading(false);
        }
      })
      .catch(() => { if (!cancelled) setStatsLoading(false); });

    return () => { cancelled = true; };
  }, []);

  const wallet = statsData?.wallet ?? null;
  const stats = statsData?.stats;
  // hasAccount: wallet connected, session premium, OR a session-profile
  // binding exists. Without the hasSessionProfile check, creating a
  // display-name-only profile leaves the user in the anonymous state
  // because wallet is still null and premium is still false.
  const hasAccount = !!wallet || premium || hasSessionProfile;
  const label =
    username ?? (wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : 'Anonymous');

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-3">
        <Avatar pfpUrl={pfpUrl} seed={username ?? wallet} />
        <div className="min-w-0">
          <h2 className="text-lg font-bold tracking-tight text-gray-900 dark:text-gray-100 truncate">
            {label}
          </h2>
          <p className="text-xs font-medium text-gray-500">Your Griddle stats</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="ml-auto w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors duration-fast"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="w-4 h-4" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      {/* Stats body */}
      <div className="mt-5">
        {statsLoading || !profileLoaded ? (
          <StatsSkeleton />
        ) : !hasAccount ? (
          <AnonymousCta onCreateProfile={onCreateProfile} />
        ) : !stats || stats.totalSolves === 0 ? (
          <div className="py-4 text-center text-sm text-gray-500">
            No solves yet. Today’s puzzle is waiting.
          </div>
        ) : (
          <StatsGrid stats={stats} />
        )}
      </div>

      {/* Premium stats: sparkline, 7-day bar chart, percentile, podium.
          Rendered once `hasAccount` is true. Real data for premium;
          free users see the same widgets behind a blur with an
          overlay upgrade CTA — the overlay IS the teaser, so no
          separate "More stats with Premium" strip underneath. */}
      {hasAccount && !statsLoading && (
        <PremiumStatsSection
          wallet={wallet}
          premium={premium}
          onUpgrade={onUpgrade}
        />
      )}

      {/* Lexicon — full Wordmarks grid. Earned wordmarks in color,
          locked ones grayed out. Modeled on LHAW's Lexicon panel.
          Replaces the old "Coming soon — achievements for your best
          solves" placeholder. */}
      {hasAccount && <LexiconGrid enabled={hasAccount} />}
    </>
  );
}

function AnonymousCta({ onCreateProfile }: { onCreateProfile: () => void }) {
  return (
    <div className="py-4 space-y-3">
      <p className="text-sm text-gray-600 dark:text-gray-400 text-center leading-relaxed">
        Sign in to track your streaks, fastest times, and carry your progress across devices.
      </p>
      <button type="button" onClick={onCreateProfile} className="btn-primary w-full">
        Sign in
      </button>
    </div>
  );
}

function StatsSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-16 rounded-md bg-gray-100 dark:bg-gray-800 animate-pulse" />
      ))}
    </div>
  );
}

function StatsGrid({ stats }: { stats: WalletStats }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <StatCell label="Solves" value={stats.totalSolves.toString()} />
      <StatCell label="Unassisted" value={stats.unassistedSolves.toString()} />
      <StatCell label="Current" value={stats.currentStreak > 0 ? `${stats.currentStreak}🔥` : '0'} />
      <StatCell label="Longest" value={stats.longestStreak.toString()} />
      <StatCell label="Fastest" value={stats.fastestMs != null ? formatMs(stats.fastestMs) : '—'} />
      <StatCell label="Average" value={stats.averageMs != null ? formatMs(stats.averageMs) : '—'} />
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 dark:bg-gray-800 rounded-md p-3 text-center">
      <div className="text-base font-black text-gray-900 dark:text-gray-100 tabular-nums">{value}</div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}
