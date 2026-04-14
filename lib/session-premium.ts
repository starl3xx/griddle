import { kv } from './kv';

/**
 * Server-side session → premium status mapping in Upstash.
 *
 * Mirrors the `wallet-session.ts` pattern. Used for fiat buyers who
 * pay with Stripe before (or without ever) connecting a wallet. The
 * webhook sets this key; GameClient reads it via /api/premium/session
 * on page load. On first wallet connect, if the session carries
 * premium, the client calls /api/premium/migrate to write a
 * `premium_users` row so the wallet-keyed read path also sees it.
 *
 * TTL: 1 year — long enough to be permanent for practical purposes,
 * avoiding the need to query the DB on every anonymous page load.
 * The wallet migration makes the key redundant once a wallet is
 * linked, but there is no harm in leaving it in Redis.
 */

const KEY = (sessionId: string) => `griddle:session-premium:${sessionId}`;
const ONE_YEAR = 60 * 60 * 24 * 365;

export interface SessionPremiumValue {
  stripeSessionId: string;
}

export async function getSessionPremium(
  sessionId: string,
): Promise<SessionPremiumValue | null> {
  try {
    return await kv.get<SessionPremiumValue>(KEY(sessionId));
  } catch (err) {
    console.warn(`[session-premium] get failed for ${sessionId}:`, err);
    return null;
  }
}

/**
 * Throws on KV failure so the Stripe webhook can return 500 and
 * trigger a retry — a swallowed error would return 200 and Stripe
 * would never redeliver, leaving a no-wallet buyer with no premium
 * record anywhere.
 */
export async function setSessionPremium(
  sessionId: string,
  stripeSessionId: string,
): Promise<void> {
  await kv.set<SessionPremiumValue>(
    KEY(sessionId),
    { stripeSessionId },
    { ex: ONE_YEAR },
  );
}
