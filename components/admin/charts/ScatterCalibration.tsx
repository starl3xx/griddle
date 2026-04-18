'use client';

import {
  CartesianGrid,
  Label,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';

export interface CalibrationPoint {
  heuristic: number;
  observedAvgMs: number;
  answer: string;
  residual: number;
}

interface ScatterCalibrationProps {
  points: CalibrationPoint[];
  /** OLS regression coefficients used to draw the trend line. */
  slope: number;
  intercept: number;
  height?: number;
}

/**
 * Heuristic difficulty score × observed solve time. Each dot is one
 * puzzle; the straight line is the OLS fit rendered as a
 * `ReferenceLine` segment so it has no dependency on a separate data
 * series or ComposedChart-level axis coupling. Outliers (large
 * |residual|) are where the heuristic diverges from reality and are
 * the signal for refining the formula's coefficients.
 */
export function ScatterCalibration({ points, slope, intercept, height = 300 }: ScatterCalibrationProps) {
  if (points.length < 2) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400 py-8 text-center">
        Need at least 2 puzzles with solve data to calibrate. Keep playing.
      </p>
    );
  }
  const xs = points.map((p) => p.heuristic);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yAtXMin = slope * xMin + intercept;
  const yAtXMax = slope * xMax + intercept;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 12, right: 16, left: 0, bottom: 24 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis
          type="number"
          dataKey="heuristic"
          domain={[0, 100]}
          tick={{ fontSize: 10, fill: '#6b7280' }}
        >
          <Label value="Heuristic score" offset={-16} position="insideBottom" style={{ fontSize: 11, fill: '#6b7280' }} />
        </XAxis>
        <YAxis
          type="number"
          dataKey="observedAvgMs"
          tick={{ fontSize: 10, fill: '#6b7280' }}
          tickFormatter={(v: number) => `${Math.round(v / 1000)}s`}
          width={50}
        >
          <Label
            value="Observed avg solve"
            angle={-90}
            position="insideLeft"
            style={{ fontSize: 11, fill: '#6b7280', textAnchor: 'middle' }}
          />
        </YAxis>
        <ZAxis type="number" range={[40, 40]} />
        <Tooltip
          cursor={{ strokeDasharray: '3 3' }}
          contentStyle={{ fontSize: 12, borderRadius: 6, border: '1px solid #e5e7eb' }}
          formatter={(value, name) => {
            const v = Number(value);
            if (name === 'observedAvgMs') return [`${(v / 1000).toFixed(1)}s`, 'Observed'];
            if (name === 'heuristic') return [String(v), 'Heuristic'];
            return [String(value), String(name)];
          }}
          labelFormatter={() => ''}
        />
        <Scatter data={points} fill="#8b5cf6" />
        <ReferenceLine
          segment={[
            { x: xMin, y: yAtXMin },
            { x: xMax, y: yAtXMax },
          ]}
          stroke="#f59e0b"
          strokeWidth={2}
          ifOverflow="extendDomain"
        />
      </ScatterChart>
    </ResponsiveContainer>
  );
}
