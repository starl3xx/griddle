/**
 * Shared funnel-rollup types.
 *
 * These live in a type-only file (no runtime imports, no drizzle, no
 * db/client) so both server queries and `'use client'` components can
 * depend on the same shape without the client bundler pulling in the
 * postgres driver or other server-only modules. Keeps the Funnel tab
 * and the /api/admin/funnel query in lockstep — a field rename here
 * surfaces as a type error on both sides.
 */

export type FunnelWindow = '24h' | '7d' | '30d' | 'all';

export interface FunnelStageRow {
  eventName: string;
  sessions: number;
  total: number;
}

export interface FunnelBreakdownRow {
  eventName: string;
  bucket: string;
  sessions: number;
  total: number;
}

export interface FunnelTimeToConvertRow {
  method: 'crypto' | 'fiat';
  ms: number | null;
}

export interface FunnelStats {
  window: FunnelWindow;
  stages: FunnelStageRow[];
  /**
   * Event × metadata-bucket breakdown. Lets the Funnel tab split
   * `upgrade_clicked` and `checkout_*` by method, `premium_gate_shown`
   * by feature, `checkout_failed` by reason, etc., without re-scanning
   * the table per dimension.
   */
  breakdown: FunnelBreakdownRow[];
  /** Median ms from upgrade_clicked to checkout_completed, per method. */
  medianTimeToConvertMs: FunnelTimeToConvertRow[];
}
