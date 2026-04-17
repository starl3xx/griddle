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

/**
 * Same as `setSessionWallet`, but propagates the KV error instead of
 * swallowing it. Use from paths where a failed binding is silently
 * catastrophic — e.g. /api/wallet/link, where if this fails the
 * session's subsequent solves / crumbs are attributed session-only
 * (no wallet) and the user ends up with orphan rows that never tie
 * back to their wallet on any future surface.
 *
 * Mirrors `setSessionProfileOrThrow`'s fail-loud contract for the
 * same reason.
 */
export async function setSessionWalletOrThrow(
  sessionId: string,
  wallet: string,
): Promise<void> {
  await kv.set(KEY(sessionId), wallet.toLowerCase(), { ex: ONE_YEAR_SECONDS });
}

export async function clearSessionWallet(sessionId: string): Promise<void> {
  try {
    await kv.del(KEY(sessionId));
  } catch (err) {
    console.warn(`[wallet-session] del failed for ${sessionId}:`, err);
  }
}
