import { kv } from '@/lib/kv';

/**
 * Fixed-window rate limiter backed by Upstash Redis.
 *
 * A single EVAL per check so the INCR and the first-hit EXPIRE land in
 * the same atomic Redis step — a network blip between a separate INCR
 * and EXPIRE would orphan the key without a TTL and permanently
 * rate-limit the caller. The same script also returns the key's real
 * PTTL so `resetAt` reflects when the window actually expires, not when
 * a window starting at the current request would expire.
 *
 * Fixed windows are less precise than a sliding log but fine for the
 * griefing-class threats we're defending against (casual flood, not a
 * sophisticated actor).
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

// Atomic INCR + first-hit EXPIRE, returning [count, pttl_ms]. PTTL
// returns -1 for a key with no TTL (shouldn't happen after this runs,
// but we still guard against it) and -2 if the key doesn't exist (can't
// happen — INCR just created it).
const INCR_WITH_TTL_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return { count, redis.call('PTTL', KEYS[1]) }
`.trim();

export async function checkRateLimit(
  key: string,
  limit: number,
  windowSec: number,
): Promise<RateLimitResult> {
  const redisKey = `griddle:ratelimit:${key}`;
  const nowMs = Date.now();

  try {
    const result = (await kv.eval(
      INCR_WITH_TTL_SCRIPT,
      [redisKey],
      [String(windowSec)],
    )) as [number, number];
    const count = Number(result[0]);
    const pttlMs = Number(result[1]);
    // If PTTL came back -1 (key somehow exists without TTL), fall back
    // to windowSec so resetAt is at worst over-estimated rather than
    // stuck at epoch. Same for -2 (key not found, impossible here).
    const effectiveTtlMs = pttlMs > 0 ? pttlMs : windowSec * 1000;
    const resetAt = Math.floor((nowMs + effectiveTtlMs) / 1000);
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
      resetAt: Math.floor(nowMs / 1000) + windowSec,
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
