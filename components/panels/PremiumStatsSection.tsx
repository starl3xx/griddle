'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Crown } from '@phosphor-icons/react';
import type { PremiumStats } from '@/lib/db/queries';

/**
 * Lazy-load the recharts-using chart body so the ~50KB recharts bundle
 * only ships once a premium user actually opens the Stats panel. Free
 * users render the lightweight static placeholder below the upgrade
 * overlay and never trigger the import — verified by Next's chunk
 * splitter (the `next/dynamic` boundary becomes a separate chunk).
 *
 * `ssr: false` because the placeholder + skeleton handle the
 * pre-hydration paint just fine and it lets recharts skip the
 * server-render path entirely (no hydration mismatch risk).
 */
const PremiumStatsCharts = dynamic(
  () => import('./PremiumStatsCharts').then((m) => ({ default: m.PremiumStatsCharts })),
  { ssr: false, loading: () => <ChartsSkeleton /> },
);

interface PremiumStatsSectionProps {
  wallet: string | null;
  premium: boolean;
  onUpgrade: () => void;
}

interface PremiumStatsResponse {
  wallet: string | null;
  stats: PremiumStats | null;
}

/**
 * Premium stats dashboard wrapper. Owns the fetch + state machine
 * (loading / errored / data) and the free-user upgrade overlay; the
 * actual chart rendering lives in the dynamically-imported
 * `PremiumStatsCharts` so non-premium users never download recharts.
 *
 * Render matrix:
 *   - premium + wallet → fetch `/api/stats/premium`, lazy-load charts
 *   - premium + fetch failed → inline error card
 *   - free / no wallet → static placeholder behind a blur + upgrade CTA
 */
export function PremiumStatsSection({
  wallet,
  premium,
  onUpgrade,
}: PremiumStatsSectionProps) {
  const [stats, setStats] = useState<PremiumStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    if (!premium || !wallet) return;
    let cancelled = false;
    setLoading(true);
    setErrored(false);
    fetch('/api/stats/premium')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: PremiumStatsResponse | null) => {
        if (!cancelled) {
          setStats(j?.stats ?? null);
          setErrored(false);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setErrored(true);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [premium, wallet]);

  // Premium + fetch failed: surface the error instead of silently
  // rendering a placeholder as if it were real data. Showing
  // fabricated numbers in the premium slot is worse than showing a
  // retry — users trust whatever they see here.
  if (premium && errored) {
    return (
      <section className="mt-5 bg-error-50 dark:bg-error-900/30 border border-error-200 dark:border-error-700 rounded-md p-3 text-center animate-fade-in">
        <p className="text-sm font-semibold text-error-700 dark:text-error-300">
          Couldn’t load premium stats.
        </p>
        <p className="text-xs text-error-600 dark:text-error-400 mt-1">
          Try again in a moment — your stats are safe.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-5 relative animate-fade-in">
      {premium ? (
        loading || !stats ? (
          <ChartsSkeleton />
        ) : (
          <PremiumStatsCharts stats={stats} />
        )
      ) : (
        <>
          <div
            className="space-y-4 opacity-40 blur-[2px] pointer-events-none select-none"
            aria-hidden
          >
            <PlaceholderCharts />
          </div>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="bg-white dark:bg-gray-800 border border-accent/30 rounded-md px-4 py-3 shadow-card text-center space-y-2 max-w-[240px]">
              <Crown className="w-5 h-5 text-accent mx-auto" weight="fill" aria-hidden />
              <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
                Unlock with Premium
              </p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-snug">
                See your solve trend, weekly pacing, today’s percentile, and career podium.
              </p>
              <button type="button" onClick={onUpgrade} className="btn-accent w-full text-xs">
                See Premium options
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

// ─── Free-user placeholder (no recharts) ──────────────────────────
//
// Static blocks shaped like the real charts so the blurred preview
// behind the upgrade CTA looks populated. Intentionally NOT importing
// recharts — that would defeat the lazy-load and force every free
// session to download the chart library on Stats panel open.

function PlaceholderCharts() {
  return (
    <div className="space-y-4">
      <PlaceholderCard label="Solve trend">
        <svg viewBox="0 0 420 80" className="w-full h-20" preserveAspectRatio="none">
          <path
            d="M8 60 L60 40 L120 50 L180 25 L240 35 L300 18 L360 30 L412 20 L412 80 L8 80 Z"
            className="fill-brand/20 dark:fill-brand-400/20"
          />
          <path
            d="M8 60 L60 40 L120 50 L180 25 L240 35 L300 18 L360 30 L412 20"
            fill="none"
            strokeWidth={1.75}
            className="stroke-brand dark:stroke-brand-400"
          />
        </svg>
      </PlaceholderCard>
      <PlaceholderCard label="Last 7 days">
        <div className="flex items-end justify-between gap-1.5 h-24">
          {[60, 80, 45, 0, 70, 55, 90].map((h, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              {h === 0 ? (
                <div className="w-full h-full rounded-sm border-2 border-dashed border-gray-300 dark:border-gray-600" />
              ) : (
                <div
                  className="w-full rounded-sm bg-brand dark:bg-brand-400"
                  style={{ height: `${h}%` }}
                />
              )}
            </div>
          ))}
        </div>
      </PlaceholderCard>
      <div className="bg-gray-50 dark:bg-gray-800 rounded-md p-3 text-center">
        <PlaceholderHeader label="Today" center />
        <div className="mt-1 text-2xl font-black text-brand dark:text-brand-400 tabular-nums">
          Top 15%
        </div>
      </div>
      <PlaceholderCard label="Career podium">
        <div className="flex items-end justify-center gap-3 h-24">
          {[
            { h: 70, c: 'bg-[#C0C0C0]' },
            { h: 100, c: 'bg-[#FFD700]' },
            { h: 50, c: 'bg-[#CD7F32]' },
          ].map((b, i) => (
            <div
              key={i}
              className={`flex-1 max-w-[72px] rounded-t-sm ${b.c}`}
              style={{ height: `${b.h}%` }}
            />
          ))}
        </div>
      </PlaceholderCard>
    </div>
  );
}

function PlaceholderCard({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-gray-50 dark:bg-gray-800 rounded-md p-3">
      <PlaceholderHeader label={label} />
      <div className="mt-2">{children}</div>
    </div>
  );
}

function PlaceholderHeader({ label, center }: { label: string; center?: boolean }) {
  return (
    <div
      className={[
        'text-[10px] font-bold uppercase tracking-wider text-gray-500',
        center ? 'text-center' : '',
      ].join(' ')}
    >
      {label}
    </div>
  );
}

function ChartsSkeleton() {
  return (
    <div className="space-y-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-24 rounded-md bg-gray-100 dark:bg-gray-800 animate-pulse" />
      ))}
    </div>
  );
}
