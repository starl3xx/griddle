import { kv } from './kv';

/**
 * Server-side mapping from anonymous session_id → connected wallet
 * address. Lives in Upstash so /api/solve can attribute new solves to
 * the wallet without the client having to pass it (and without the
 * server having to trust the client's claim).
 *
 * Lifecycle:
 *   - POST /api/wallet/link → setSessionWallet
 *   - /api/solve → getSessionWallet, include in the new row
 *   - DELETE /api/wallet/link (on disconnect) → clearSessionWallet
 *
 * TTL matches the session cookie lifetime (1 year). Failures fall
 * through to "no wallet attributed" — same graceful degradation as
 * the puzzle cache helpers.
 */

const KEY = (sessionId: string) => `griddle:session-wallet:${sessionId}`;
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export async function getSessionWallet(sessionId: string): Promise<string | null> {
  try {
    return await kv.get<string>(KEY(sessionId));
  } catch (err) {
    console.warn(`[wallet-session] get failed for ${sessionId}:`, err);
    return null;
  }
}

export async function setSessionWallet(sessionId: string, wallet: string): Promise<void> {
  try {
    await kv.set(KEY(sessionId), wallet.toLowerCase(), { ex: ONE_YEAR_SECONDS });
  } catch (err) {
    console.warn(`[wallet-session] set failed for ${sessionId}:`, err);
  }
}

export async function clearSessionWallet(sessionId: string): Promise<void> {
  try {
    await kv.del(KEY(sessionId));
  } catch (err) {
    console.warn(`[wallet-session] del failed for ${sessionId}:`, err);
  }
}
