'use client';

import { useEffect, useState } from 'react';
import { Diamond, Moon, Sun, ShieldCheck, Eye, EyeSlash, Question } from '@phosphor-icons/react';
import { formatMs } from '@/lib/format';
import { Avatar } from './Avatar';
import type { WalletStats } from '@/lib/db/queries';

interface StatsResponse {
  wallet: string | null;
  stats?: WalletStats;
}

interface SettingsResponse {
  streakProtectionEnabled: boolean;
  streakProtectionUsedAt: string | null;
  unassistedModeEnabled: boolean;
  darkModeEnabled: boolean;
}

interface StatsModalProps {
  open: boolean;
  premium: boolean;
  dark: boolean;
  onToggleDark: () => void;
  onClose: () => void;
  /** Opens the wallet connector picker in the parent. */
  onConnect: () => void;
  /** Opens the premium gate modal for users who want to upgrade. */
  onUpgrade: () => void;
  pfpUrl: string | null;
  displayName: string | null;
}

// 7-day streak protection cooldown
const PROTECTION_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Stats modal — three states based on identity + premium:
 *
 *  1. **Anonymous** — no wallet, no session premium. Shows upgrade CTAs.
 *  2. **Account** — wallet connected or session premium, no premium unlocked.
 *     Shows basic stats + upsell strip.
 *  3. **Premium** — full stats grid + settings panel (streak protection,
 *     unassisted mode) + dark mode toggle + Wordmarks + FAQ link.
 *
 * Dark mode toggle is visible to everyone regardless of premium state.
 */
export function StatsModal({
  open,
  premium,
  dark,
  onToggleDark,
  onClose,
  onConnect,
  onUpgrade,
  pfpUrl,
  displayName,
}: StatsModalProps) {
  const [statsData, setStatsData] = useState<StatsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [savingProtection, setSavingProtection] = useState(false);
  const [savingUnassisted, setSavingUnassisted] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setStatsLoading(true);
    setStatsData(null);
    setSettings(null);

    const fetches: Promise<void>[] = [
      fetch('/api/stats')
        .then((r) => r.ok ? r.json() : null)
        .then((j: StatsResponse | null) => { if (!cancelled) { setStatsData(j); setStatsLoading(false); } })
        .catch(() => { if (!cancelled) setStatsLoading(false); }),
    ];

    if (premium) {
      fetches.push(
        fetch('/api/settings')
          .then((r) => r.ok ? r.json() : null)
          .then((s: SettingsResponse | null) => { if (!cancelled) setSettings(s); })
          .catch(() => {}),
      );
    }

    Promise.all(fetches).catch(() => {});
    return () => { cancelled = true; };
  }, [open, premium]);

  const toggleSetting = async (field: 'streakProtectionEnabled' | 'unassistedModeEnabled') => {
    if (!settings) return;
    const current = field === 'streakProtectionEnabled'
      ? settings.streakProtectionEnabled
      : settings.unassistedModeEnabled;
    const next = !current;
    const setSaving = field === 'streakProtectionEnabled' ? setSavingProtection : setSavingUnassisted;
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ [field]: next }),
      });
      if (res.ok) {
        const updated = (await res.json()) as SettingsResponse;
        setSettings(updated);
      }
    } catch {/* best-effort */} finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const wallet = statsData?.wallet ?? null;
  const stats = statsData?.stats;
  const hasAccount = !!wallet;
  const monogram = wallet ? wallet.slice(2, 3).toUpperCase() : '?';
  const label = displayName ?? (wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : 'Anonymous');

  // Streak protection cooldown
  const protectionUsedAt = settings?.streakProtectionUsedAt
    ? new Date(settings.streakProtectionUsedAt)
    : null;
  const protectionOnCooldown = protectionUsedAt
    ? Date.now() - protectionUsedAt.getTime() < PROTECTION_COOLDOWN_MS
    : false;
  const cooldownDaysLeft = protectionOnCooldown && protectionUsedAt
    ? Math.ceil((PROTECTION_COOLDOWN_MS - (Date.now() - protectionUsedAt.getTime())) / (24 * 60 * 60 * 1000))
    : 0;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="modal-sheet sm:rounded-card animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3">
          <Avatar pfpUrl={pfpUrl} monogram={monogram} />
          <div className="min-w-0">
            <h2 className="text-lg font-black tracking-tight text-gray-900 dark:text-gray-100 truncate">
              {label}
            </h2>
            <p className="text-xs font-medium text-gray-500">Your Griddle stats</p>
          </div>
          <div className="ml-auto flex items-center gap-1">
            {/* Dark mode toggle — universal */}
            <button
              type="button"
              onClick={onToggleDark}
              aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
              className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors duration-fast"
            >
              {dark
                ? <Sun className="w-4 h-4" weight="bold" aria-hidden />
                : <Moon className="w-4 h-4" weight="bold" aria-hidden />}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close stats"
              className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors duration-fast"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="w-4 h-4" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Stats body */}
        <div className="mt-5">
          {statsLoading ? (
            <StatsSkeleton />
          ) : !hasAccount ? (
            <AnonymousState onConnect={onConnect} onUpgrade={onUpgrade} />
          ) : !stats || stats.totalSolves === 0 ? (
            <div className="py-4 text-center text-sm text-gray-500">
              No solves yet. Today's puzzle is waiting.
            </div>
          ) : (
            <StatsGrid stats={stats} />
          )}
        </div>

        {/* Premium upsell for non-premium accounts */}
        {!premium && hasAccount && (
          <div className="mt-4 border border-accent/30 rounded-md p-3 flex items-center gap-3">
            <Diamond className="w-5 h-5 text-accent flex-shrink-0" weight="fill" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Unlock premium</p>
              <p className="text-[11px] text-gray-500">Leaderboard, archive, streak protection &amp; more.</p>
            </div>
            <button type="button" onClick={onUpgrade} className="btn-accent py-1.5 px-3 text-xs flex-shrink-0">
              Upgrade
            </button>
          </div>
        )}

        {/* Premium settings — only when wallet is connected (settings PATCH
            requires a wallet; session-only premium users see the upsell strip
            which prompts them to connect a wallet to unlock settings). */}
        {premium && hasAccount && (
          <div className="mt-5 border-t border-gray-100 dark:border-gray-800 pt-4 space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Settings</p>

            <SettingRow
              icon={<ShieldCheck className="w-4 h-4" weight="bold" />}
              label="Streak protection"
              description={
                protectionOnCooldown
                  ? `Available again in ${cooldownDaysLeft}d`
                  : settings?.streakProtectionEnabled
                    ? 'Armed — will save your streak once'
                    : 'Saves your streak if you miss a day'
              }
              checked={settings?.streakProtectionEnabled ?? false}
              disabled={savingProtection || protectionOnCooldown}
              onChange={() => toggleSetting('streakProtectionEnabled')}
            />

            <SettingRow
              icon={settings?.unassistedModeEnabled
                ? <EyeSlash className="w-4 h-4" weight="bold" />
                : <Eye className="w-4 h-4" weight="bold" />}
              label="Unassisted mode"
              description="Hides cell hints — earn 🎯 Ace for solving blind"
              checked={settings?.unassistedModeEnabled ?? false}
              disabled={savingUnassisted}
              onChange={() => toggleSetting('unassistedModeEnabled')}
            />
          </div>
        )}

        {/* Wordmarks placeholder */}
        {premium && hasAccount && (
          <div className="mt-4 border-t border-gray-100 dark:border-gray-800 pt-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Wordmarks</p>
            <p className="text-xs text-gray-400 italic">Coming soon — achievements for your best solves.</p>
          </div>
        )}

        {/* FAQ link */}
        <div className="mt-4 border-t border-gray-100 dark:border-gray-800 pt-3 flex items-center justify-center gap-1.5">
          <Question className="w-3.5 h-3.5 text-gray-400" weight="bold" aria-hidden />
          <a
            href="/faq"
            className="text-xs font-semibold text-gray-400 hover:text-brand transition-colors"
          >
            FAQ
          </a>
        </div>
      </div>
    </div>
  );
}

function AnonymousState({ onConnect, onUpgrade }: { onConnect: () => void; onUpgrade: () => void }) {
  return (
    <div className="py-4 space-y-3">
      <p className="text-sm text-gray-600 dark:text-gray-400 text-center leading-relaxed">
        Track your streaks and fastest times by connecting a wallet or unlocking premium.
      </p>
      <button type="button" onClick={onConnect} className="btn-primary w-full">
        Connect wallet
      </button>
      <button type="button" onClick={onUpgrade} className="btn-secondary w-full inline-flex items-center justify-center gap-2">
        <Diamond className="w-4 h-4 text-accent" weight="fill" aria-hidden />
        Unlock with card or crypto
      </button>
    </div>
  );
}

function SettingRow({
  icon, label, description, checked, disabled, onChange,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-accent flex-shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{label}</p>
        <p className="text-[11px] text-gray-500">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={onChange}
        className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full transition-colors duration-fast focus:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50 disabled:cursor-not-allowed ${checked ? 'bg-accent' : 'bg-gray-300 dark:bg-gray-600'}`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-fast mt-0.5 ${checked ? 'translate-x-4' : 'translate-x-0.5'}`}
        />
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
