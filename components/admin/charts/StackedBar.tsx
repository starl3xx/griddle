'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface StackedBarPoint {
  day: string;
  [k: string]: number | string;
}

interface SeriesConfig {
  dataKey: string;
  label: string;
  fill: string;
}

interface StackedBarProps {
  data: StackedBarPoint[];
  series: SeriesConfig[];
  height?: number;
  /**
   * Value formatter for tooltip and y-axis. Defaults to a $ format.
   */
  format?: (v: number) => string;
}

/**
 * Stacked bar chart — revenue-by-day with source as the stack key.
 * Defaults to USD formatting so the Pulse Revenue strip just works.
 */
export function StackedBar({ data, series, height = 240, format }: StackedBarProps) {
  const fmt = format ?? ((v: number) => `$${v.toFixed(0)}`);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis
          dataKey="day"
          tick={{ fontSize: 10, fill: '#6b7280' }}
          tickFormatter={(v: string) => v.slice(5)}
          minTickGap={16}
        />
        <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickFormatter={(v: number) => fmt(v)} width={50} />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 6, border: '1px solid #e5e7eb' }}
          labelStyle={{ fontWeight: 600 }}
          formatter={(v) => fmt(Number(v))}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {series.map((s) => (
          <Bar key={s.dataKey} dataKey={s.dataKey} name={s.label} fill={s.fill} stackId="a" />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
