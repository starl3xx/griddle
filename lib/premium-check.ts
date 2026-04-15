import { sql } from 'drizzle-orm';
import { db } from './db/client';
import { getSessionWallet } from './wallet-session';
import { getSessionPremium } from './session-premium';

/**
 * Server-side "is this session premium?" check.
 *
 * Two independent sources of truth, mirroring the client-side logic in
 * GameClient:
 *
 *   1. **Session-keyed** (Upstash KV) — set by the Stripe webhook for
 *      fiat buyers who haven't connected a wallet. Fastest path.
 *   2. **Wallet-keyed** (`premium_users` table) — set by the crypto
 *      unlock flow, the Stripe migration flow, or an admin grant. We
 *      fall through here only if the session has a bound wallet AND
 *      the KV check missed.
 *
 * Uses raw SQL for the wallet lookup to sidestep the drizzle `eq()`
 * drift documented in commit 6fe4fe7 on `/api/premium/[wallet]`. The
 * drift repros specifically on the premium_users table, so keep the
 * raw SELECT here.
 *
 * Returns `false` on any error so a KV or DB flake fails closed
 * (non-premium) rather than granting premium features accidentally.
 */
export async function isSessionPremium(sessionId: string): Promise<boolean> {
  try {
    const sessionPremium = await getSessionPremium(sessionId);
    if (sessionPremium !== null) return true;

    const wallet = await getSessionWallet(sessionId);
    if (!wallet) return false;

    const normalized = wallet.toLowerCase();
    const result = await db.execute<{ wallet: string }>(sql`
      SELECT wallet FROM premium_users WHERE wallet = ${normalized} LIMIT 1
    `);
    const rows = Array.isArray(result) ? result : (result.rows ?? []);
    return rows.length > 0;
  } catch (err) {
    console.warn('[premium-check] isSessionPremium failed:', err);
    return false;
  }
}
