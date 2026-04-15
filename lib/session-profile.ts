import { kv } from './kv';

/**
 * Server-side session → profile id binding in Upstash.
 *
 * Mirrors the `wallet-session.ts` pattern. After a user verifies a
 * magic link (or creates a handle-only profile), their profile id is
 * stored here so `/api/profile` can return their profile without a
 * wallet or cookie session.
 *
 * TTL: 1 year — profiles persist long-term, so the session binding
 * should too. If the user clears cookies / gets a new session, they
 * lose the binding and must re-authenticate (magic link again).
 */

const KEY = (sessionId: string) => `griddle:session-profile:${sessionId}`;
const ONE_YEAR = 60 * 60 * 24 * 365;

export async function getSessionProfile(sessionId: string): Promise<number | null> {
  try {
    return await kv.get<number>(KEY(sessionId));
  } catch (err) {
    console.warn(`[session-profile] get failed for ${sessionId}:`, err);
    return null;
  }
}

/**
 * Bind a profile id to the session. Throws on KV failure — every
 * caller (magic-link verify, profile/create, profile/farcaster) runs
 * in a create-and-bind flow where a silent failure would strand the
 * user with a DB row and no session anchor. The previous non-throwing
 * variant was removed after all callers converged on fail-closed
 * semantics.
 */
export async function setSessionProfileOrThrow(
  sessionId: string,
  profileId: number,
): Promise<void> {
  await kv.set(KEY(sessionId), profileId, { ex: ONE_YEAR });
}
