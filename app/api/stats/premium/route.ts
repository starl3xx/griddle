import { NextResponse } from 'next/server';
import { getSessionId } from '@/lib/session';
import { resolveSessionIdentity } from '@/lib/session-identity';
import { getPremiumStats, type PremiumStats } from '@/lib/db/queries';
import { getCurrentDayNumber } from '@/lib/scheduler';
import { kv } from '@/lib/kv';

/**
 * GET /api/stats/premium
 *
 * Returns the richer stat bundle used by `PremiumStatsSection` — solve
 * trend sparkline, last-7-days bar chart, today's percentile, and
 * career placements. Resolves the caller's identity the same way
 * `/api/stats` does: profile id + wallet + session id, so handle-only
 * users see their own numbers instead of the blurred-placeholder void.
 *
 * Returns `{ stats: null }` when fully anonymous. The free-user blurred
 * preview uses *placeholder* data, not real stats, so a non-premium
 * user can't bypass the gate by scraping another wallet's numbers.
 *
 * Caching: short-TTL KV read-through keyed on the caller's canonical
 * player key + day. The percentile and placements queries scan the
 * full eligible solve history; at zero traffic the raw latency is
 * fine, but the stats panel opens on every modal toggle and the
 * numbers only turn over when new solves land. 60 seconds amortizes
 * a stats-heavy navigation session and remains fresh enough that a
 * user's own just-solved puzzle shows up promptly.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CACHE_TTL_SECONDS = 60;

export async function GET(): Promise<NextResponse> {
  const sessionId = await getSessionId();
  const { wallet, profileId } = await resolveSessionIdentity(sessionId);

  if (!wallet && profileId == null) {
    return NextResponse.json({ wallet: null, stats: null });
  }

  // Cache key matches the synthetic player_key used inside
  // getPremiumStats — profile_id preferred, wallet fallback — so a
  // user whose identity picks up a wallet mid-day doesn't suddenly
  // see a cache miss AND lose continuity with earlier solves.
  const playerKey = profileId != null ? `p:${profileId}` : wallet?.toLowerCase();
  const day = getCurrentDayNumber();
  const cacheKey = `griddle:premium-stats:${playerKey}:${day}`;

  let stats: PremiumStats | null = null;
  try {
    const cached = await kv.get<PremiumStats>(cacheKey);
    if (cached) stats = cached;
  } catch (err) {
    console.warn('[stats/premium] kv read failed, bypassing cache', err);
  }

  if (!stats) {
    stats = await getPremiumStats({ profileId, wallet, sessionId });
    try {
      await kv.set(cacheKey, stats, { ex: CACHE_TTL_SECONDS });
    } catch (err) {
      console.warn('[stats/premium] kv write failed, continuing', err);
    }
  }

  return NextResponse.json({ wallet, stats });
}
