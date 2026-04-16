import { NextResponse } from 'next/server';
import { getSessionId } from '@/lib/session';
import { getSessionWallet } from '@/lib/wallet-session';
import { getPremiumStats, type PremiumStats } from '@/lib/db/queries';
import { getCurrentDayNumber } from '@/lib/scheduler';
import { kv } from '@/lib/kv';

/**
 * GET /api/stats/premium
 *
 * Returns the richer stat bundle used by `PremiumStatsSection` — solve
 * trend sparkline, last-7-days bar chart, today's percentile, and
 * career placements. Mirrors `/api/stats` on auth (session wallet; no
 * wallet → `{ stats: null }`).
 *
 * Gated server-side on premium status? No — the free-user blurred
 * preview uses *placeholder* data, not real stats. The route still
 * only answers for the caller's own wallet, so a non-premium user
 * can't bypass the gate by scraping another wallet's numbers.
 *
 * Caching: short-TTL KV read-through keyed on wallet + day. The
 * percentile and placements queries scan the full eligible solve
 * history; at zero traffic the raw latency is fine, but the stats
 * panel opens on every modal toggle and the numbers only turn over
 * when new solves land. 60 seconds is long enough to amortize a
 * stats-heavy navigation session and short enough that a user's own
 * just-solved puzzle shows up promptly.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CACHE_TTL_SECONDS = 60;

export async function GET(): Promise<NextResponse> {
  const sessionId = await getSessionId();
  const wallet = await getSessionWallet(sessionId);

  if (!wallet) {
    return NextResponse.json({ wallet: null, stats: null });
  }

  // Key includes the day number so a puzzle rollover at UTC midnight
  // invalidates yesterday's percentile/last7Days automatically without
  // a TTL waterfall on the boundary.
  const day = getCurrentDayNumber();
  const cacheKey = `griddle:premium-stats:${wallet}:${day}`;

  let stats: PremiumStats | null = null;
  try {
    const cached = await kv.get<PremiumStats>(cacheKey);
    if (cached) stats = cached;
  } catch (err) {
    // KV down is tolerable — we'll fall through to Postgres and serve
    // fresh stats, just without the cache cushion. Log so sustained
    // outages are visible.
    console.warn('[stats/premium] kv read failed, bypassing cache', err);
  }

  if (!stats) {
    stats = await getPremiumStats(wallet);
    try {
      await kv.set(cacheKey, stats, { ex: CACHE_TTL_SECONDS });
    } catch (err) {
      console.warn('[stats/premium] kv write failed, continuing', err);
    }
  }

  return NextResponse.json({ wallet, stats });
}
