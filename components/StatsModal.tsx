'use client';

import { useEffect, useState } from 'react';
import { Diamond, Trophy } from '@phosphor-icons/react';
import { formatMs } from '@/lib/format';
import { Avatar } from './Avatar';
import type { WalletStats } from '@/lib/db/queries';

interface StatsResponse {
  wallet: string | null;
  stats?: WalletStats;
}

interface StatsModalProps {
  open: boolean;
  premium: boolean;
  /**
   * True when a session-profile KV binding exists (email/handle-only
   * profile created without wallet). Used to decide between the
   * anonymous CTA and the account stats view.
   */
  hasSessionProfile: boolean;
  /** Fires when an anonymous user clicks "Create profile". */
  onCreateProfile: () => void;
  /** Opens the premium gate modal — only used from the post-profile upsell card. */
  onUpgrade: () => void;
  onClose: () => void;
  pfpUrl: string | null;
  /** User's display name from the bound profile (or Farcaster fallback). */
  displayName: string | null;
}

/**
 * Stats modal — read-only dashboard view of the user's solve data and
 * Wordmarks. All identity editing, preferences, and premium unlock
 * flows live in SettingsModal (opened via the top-right gear button).
 *
 * Three states based on identity + premium:
 *
 *   1. **Anonymous** — no wallet, no session profile. Shows a single
 *      CTA: "Create a free profile to track your streaks and fastest
 *      times." No connect-wallet or unlock-premium buttons — those
 *      live in Settings so Stats stays focused on the dashboard.
 *   2. **Account (free)** — profile exists, no premium. Shows stats
 *      grid + a post-profile upsell strip that previews what Premium
 *      adds (Wordmarks, leaderboard, archive), without the Unlock
 *      buttons. Users upgrade from the Settings gear.
 *   3. **Premium** — full stats grid + Wordmarks card.
 */
export function StatsModal({
  open,
  premium,
  hasSessionProfile,
  onCreateProfile,
  onUpgrade,
  onClose,
  pfpUrl,
  displayName,
}: StatsModalProps) {
  const [statsData, setStatsData] = useState<StatsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
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
  }, [open]);

  if (!open) return null;

  const wallet = statsData?.wallet ?? null;
  const stats = statsData?.stats;
  // hasAccount: wallet connected, session premium, OR a session-profile
  // binding exists (email/handle-only profile). Without the hasSessionProfile
  // check, creating a display-name-only profile leaves the user in the
  // anonymous state because wallet is still null and premium is still false.
  const hasAccount = !!wallet || premium || hasSessionProfile;
  const label = displayName ?? (wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : 'Anonymous');

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="modal-sheet animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3">
          <Avatar pfpUrl={pfpUrl} />
          <div className="min-w-0">
            <h2 className="text-lg font-bold tracking-tight text-gray-900 dark:text-gray-100 truncate">
              {label}
            </h2>
            <p className="text-xs font-medium text-gray-500">Your Griddle stats</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close stats"
            className="ml-auto w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors duration-fast"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="w-4 h-4" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {/* Stats body */}
        <div className="mt-5">
          {statsLoading ? (
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

        {/* Post-profile premium upsell — preview what Premium adds.
            NO Unlock buttons here on purpose: unlock flows live in
            SettingsModal. This strip is an educational teaser to drive
            users toward the gear icon when they're interested. */}
        {!premium && hasAccount && !statsLoading && (
          <PremiumTeaser onUpgrade={onUpgrade} />
        )}

        {/* Wordmarks placeholder — free users see a locked preview,
            premium users get the "coming soon" tease (same for now). */}
        {hasAccount && (
          <div className="mt-4 border-t border-gray-100 dark:border-gray-800 pt-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">
              Wordmarks
            </p>
            <p className="text-xs text-gray-400 italic">
              Coming soon — achievements for your best solves.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function AnonymousCta({ onCreateProfile }: { onCreateProfile: () => void }) {
  return (
    <div className="py-4 space-y-3">
      <p className="text-sm text-gray-600 dark:text-gray-400 text-center leading-relaxed">
        Create a free profile to track your streaks and fastest times.
      </p>
      <button type="button" onClick={onCreateProfile} className="btn-primary w-full">
        Create profile
      </button>
    </div>
  );
}

function PremiumTeaser({ onUpgrade }: { onUpgrade: () => void }) {
  return (
    <div className="mt-4 border border-accent/30 rounded-md p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Diamond className="w-4 h-4 text-accent flex-shrink-0" weight="fill" aria-hidden />
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
          More stats with Premium
        </p>
      </div>
      <ul className="text-[11px] text-gray-500 dark:text-gray-400 space-y-1 pl-6">
        <li className="flex items-center gap-1.5">
          <Trophy className="w-3 h-3 text-accent" weight="bold" aria-hidden />
          Wordmarks — earn achievements for unassisted solves and streak milestones
        </li>
        <li>· Daily leaderboard rank &amp; archive access</li>
        <li>· Streak protection (one miss forgiven per 7 days)</li>
      </ul>
      <button
        type="button"
        onClick={onUpgrade}
        className="text-[11px] font-bold uppercase tracking-wider text-accent hover:text-accent/80 transition-colors"
      >
        See premium options →
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
