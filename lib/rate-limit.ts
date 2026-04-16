import { kv } from '@/lib/kv';

/**
 * Fixed-window rate limiter backed by Upstash Redis.
 *
 * Uses INCR + EXPIRE (only on the first hit in a window) so each call is
 * one round-trip to Upstash. A fixed window is less precise than a
 * sliding log but fine for the griefing-class threats we're defending
 * against here (casual flood, not a sophisticated actor).
 *
 * If Upstash is unreachable we fail open — an outage that silently
 * disables rate limits is preferable to one that 429s every payment
 * retry. The caller sees `{ allowed: true, degraded: true }` and can
 * still log the fall-through for alerting.
 */

export interface RateLimitResult {
  allowed: boolean;
  /** How many requests remain in the current window. */
  remaining: number;
  /** Unix epoch seconds when the window resets. */
  resetAt: number;
  /** True if Upstash was unreachable and the check was bypassed. */
  degraded?: boolean;
}

export async function checkRateLimit(
  key: string,
  limit: number,
  windowSec: number,
): Promise<RateLimitResult> {
  const redisKey = `griddle:ratelimit:${key}`;
  const now = Math.floor(Date.now() / 1000);
  const resetAt = now + windowSec;

  try {
    const count = await kv.incr(redisKey);
    if (count === 1) {
      // First hit in a fresh window — set the TTL so the counter
      // doesn't live forever. Subsequent INCRs in the same window
      // leave the TTL untouched.
      await kv.expire(redisKey, windowSec);
    }
    const remaining = Math.max(0, limit - count);
    return {
      allowed: count <= limit,
      remaining,
      resetAt,
    };
  } catch (err) {
    console.warn('[rate-limit] upstash unreachable, failing open', { key, err });
    return {
      allowed: true,
      remaining: limit,
      resetAt,
      degraded: true,
    };
  }
}

/**
 * Standard 429 response body + headers. Mirrors the retry-after and
 * ratelimit-* conventions the browser `Retry-After` handler expects.
 */
export function rateLimitResponseInit(result: RateLimitResult): ResponseInit {
  return {
    status: 429,
    headers: {
      'content-type': 'application/json',
      'retry-after': String(Math.max(1, result.resetAt - Math.floor(Date.now() / 1000))),
      'x-ratelimit-remaining': String(result.remaining),
      'x-ratelimit-reset': String(result.resetAt),
    },
  };
}
