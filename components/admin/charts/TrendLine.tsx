'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from 'recharts';

export interface TrendPoint {
  day: string;
  [k: string]: number | string;
}

interface SeriesConfig {
  dataKey: string;
  label: string;
  stroke: string;
  yAxisId?: 'left' | 'right';
}

interface TrendLineProps {
  data: TrendPoint[];
  series: SeriesConfig[];
  /** Optional height override; defaults to 240. */
  height?: number;
}

/**
 * Multi-series line chart for admin trend strips. Typical use: DAU +
 * solves on separate y-axes so they share an x (date) without one
 * series flattening the other.
 */
export function TrendLine({ data, series, height = 240 }: TrendLineProps) {
  const usesDualAxis = series.some((s) => s.yAxisId === 'right');
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis
          dataKey="day"
          tick={{ fontSize: 10, fill: '#6b7280' }}
          tickFormatter={(v: string) => v.slice(5)}
          minTickGap={16}
        />
        <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#6b7280' }} width={40} />
        {usesDualAxis && (
          <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#6b7280' }} width={40} />
        )}
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 6, border: '1px solid #e5e7eb' }}
          labelStyle={{ fontWeight: 600 }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {series.map((s) => (
          <Line
            key={s.dataKey}
            yAxisId={s.yAxisId ?? 'left'}
            type="monotone"
            dataKey={s.dataKey}
            name={s.label}
            stroke={s.stroke}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
