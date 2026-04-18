'use client';

import { useId } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';

export type Tone = 'ok' | 'warning' | 'error' | 'accent';

/** Convert a signed delta (current − prev) into a colored pill label. */
function deltaPill(delta: number | null, kind: 'abs' | 'pct') {
  if (delta === null || !Number.isFinite(delta)) return null;
  const arrow = delta > 0 ? '▲' : delta < 0 ? '▼' : '–';
  const color = delta > 0 ? 'text-emerald-600' : delta < 0 ? 'text-red-600' : 'text-gray-400 dark:text-gray-500';
  const str = kind === 'pct'
    ? `${Math.abs(delta * 100).toFixed(1)}%`
    : Math.abs(Math.round(delta)).toLocaleString();
  return { arrow, color, str };
}

interface SparklineCardProps {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  /** Tiny label under the number. */
  sub?: string;
  tone?: Tone;
  /**
   * Optional 30-day data for the inline sparkline. Renders nothing
   * if omitted or empty.
   */
  series?: Array<{ value: number }>;
  /** Current − previous period; used for the delta pill. */
  delta?: number | null;
  /** How to format the delta ('pct' = % difference, 'abs' = raw count). */
  deltaKind?: 'abs' | 'pct';
}

/**
 * MetricCard v2 — adds an optional sparkline + delta pill. Gracefully
 * degrades to the plain metric-card look when `series` is omitted, so
 * it's a drop-in replacement anywhere the old inline MetricCard was.
 */
export function SparklineCard({
  icon, label, value, sub, tone = 'ok', series, delta = null, deltaKind = 'abs',
}: SparklineCardProps) {
  // SVG ids must be a valid XML NAME. `useId()` can emit `:` which is
  // invalid inside a url(#…) reference in some user agents; sanitize
  // to word-chars only. Previously we used the raw `label` prop which
  // contained spaces and "·", causing the `fill="url(#...)"` lookup
  // to miss and gradients to render blank.
  const rawId = useId();
  const gradientId = `spark-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const pill = deltaPill(delta, deltaKind);
  const iconClass: Record<Tone, string> = {
    ok: 'text-gray-400 dark:text-gray-500', warning: 'text-warning', error: 'text-error', accent: 'text-accent',
  };
  const valueClass: Record<Tone, string> = {
    ok: 'text-gray-900 dark:text-gray-100', warning: 'text-warning-700', error: 'text-error-600', accent: 'text-accent-700',
  };
  const strokeColor: Record<Tone, string> = {
    ok: '#9ca3af', warning: '#f59e0b', error: '#ef4444', accent: '#8b5cf6',
  };
  return (
    <Card>
      <CardContent className="flex flex-col gap-1">
        <div className={`flex items-center gap-2 ${iconClass[tone]}`}>
          {icon}
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {label}
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <div className={`text-3xl font-black tabular-nums ${valueClass[tone]}`}>
            {typeof value === 'number' ? value.toLocaleString() : value}
          </div>
          {pill && (
            <span className={`text-[11px] font-bold ${pill.color}`} aria-label="change from prior period">
              {pill.arrow} {pill.str}
            </span>
          )}
        </div>
        {sub && <div className="text-[11px] font-medium text-gray-400 dark:text-gray-500">{sub}</div>}
        {series && series.length > 0 && (
          <div className="h-8 -mx-1 mt-1">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={strokeColor[tone]} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={strokeColor[tone]} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={strokeColor[tone]}
                  strokeWidth={1.5}
                  fill={`url(#${gradientId})`}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
