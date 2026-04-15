'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Pulse,
  Warning,
  Crown,
  CircleNotch,
  ArrowsClockwise,
  TrendUp,
  Users,
} from '@phosphor-icons/react';

interface PulseData {
  solves24h: number;
  solves7d: number;
  activeWallets7d: number;
  flaggedSolves24h: number;
  flaggedRatePct: number;
  premiumUsersTotal: number;
}

/**
 * Pulse tab — five-card health grid for the admin dashboard.
 * Self-fetching so dropping it into other surfaces doesn't require
 * threading state from the parent.
 *
 * Cards reference the same palette as the rest of the admin:
 * brand for primary numbers, accent for premium, error/warning for
 * the anomaly rate threshold, muted gray for secondary context.
 */
export function PulseTab() {
  const [data, setData] = useState<PulseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPulse = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/pulse', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      const json = (await res.json()) as PulseData;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPulse();
  }, [fetchPulse]);

  if (loading && !data) {
    return (
      <div className="flex justify-center py-12">
        <CircleNotch className="h-6 w-6 animate-spin text-gray-400" weight="bold" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-error mb-4">{error}</p>
        <Button variant="outline" size="sm" onClick={fetchPulse}>
          <ArrowsClockwise className="h-4 w-4 mr-2" weight="bold" />
          Retry
        </Button>
      </div>
    );
  }

  if (!data) return null;

  // Flagged rate threshold: green under 5%, yellow 5–15%, red 15%+.
  // Picked to surface bot surges without alarming on a single flag day.
  const flagTone =
    data.flaggedRatePct >= 15
      ? 'error'
      : data.flaggedRatePct >= 5
        ? 'warning'
        : 'ok';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold tracking-tight text-gray-900">
          Pulse
        </h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchPulse}
          disabled={loading}
          aria-label="Refresh pulse"
        >
          {loading ? (
            <CircleNotch className="h-4 w-4 animate-spin" weight="bold" />
          ) : (
            <ArrowsClockwise className="h-4 w-4" weight="bold" />
          )}
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <MetricCard
          icon={<Pulse className="h-4 w-4" weight="bold" />}
          label="Solves · 24h"
          value={data.solves24h}
          sub={`${data.solves7d} in last 7d`}
        />
        <MetricCard
          icon={<Users className="h-4 w-4" weight="bold" />}
          label="Active wallets · 7d"
          value={data.activeWallets7d}
          sub="distinct"
        />
        <MetricCard
          icon={<TrendUp className="h-4 w-4" weight="bold" />}
          label="Solves · 7d"
          value={data.solves7d}
          sub="solved = true"
        />
        <MetricCard
          icon={<Warning className="h-4 w-4" weight="bold" />}
          label="Flagged · 24h"
          value={data.flaggedSolves24h}
          sub={`${data.flaggedRatePct.toFixed(1)}% of last 24h`}
          tone={flagTone}
        />
        <MetricCard
          icon={<Crown className="h-4 w-4" weight="bold" />}
          label="Premium users"
          value={data.premiumUsersTotal}
          sub="all-time"
          tone="accent"
        />
      </div>
    </div>
  );
}

interface MetricCardProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  sub: string;
  tone?: 'ok' | 'warning' | 'error' | 'accent';
}

function MetricCard({ icon, label, value, sub, tone = 'ok' }: MetricCardProps) {
  const iconToneClass: Record<NonNullable<MetricCardProps['tone']>, string> = {
    ok: 'text-gray-400',
    warning: 'text-warning',
    error: 'text-error',
    accent: 'text-accent',
  };
  const valueToneClass: Record<NonNullable<MetricCardProps['tone']>, string> = {
    ok: 'text-gray-900',
    warning: 'text-warning-700',
    error: 'text-error-600',
    accent: 'text-accent-700',
  };
  return (
    <Card>
      <CardContent className="flex flex-col gap-1">
        <div className={`flex items-center gap-2 ${iconToneClass[tone]}`}>
          {icon}
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
            {label}
          </span>
        </div>
        <div
          className={`text-3xl font-black tabular-nums ${valueToneClass[tone]}`}
        >
          {value.toLocaleString()}
        </div>
        <div className="text-[11px] font-medium text-gray-400">{sub}</div>
      </CardContent>
    </Card>
  );
}
