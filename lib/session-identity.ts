import { getSessionWallet } from './wallet-session';
import { getSessionProfile, setSessionProfileOrThrow } from './session-profile';
import { getProfileByWallet } from './db/queries';

/**
 * Canonical identity for a session — the shape every downstream
 * `playerKeyFor` / `solveBelongsTo` caller should consume. `sessionId`
 * tags along so `solveBelongsTo` can match pre-backfill anonymous
 * rows without the caller re-reading it.
 */
export interface SessionIdentity {
  sessionId: string;
  wallet: string | null;
  profileId: number | null;
}

/**
 * Read the session's durable identity bindings with wallet→profile
 * backfill for sessions that lost (or never set) their profile-id KV
 * binding.
 *
 * Why the backfill: `session-profile` KV is written only from the
 * magic-link verify / profile-create / farcaster-bind flows.
 * `/api/wallet/link` does reconcile case (c) at link time — but a
 * session that reconnected a wallet outside that path (or was linked
 * before the reconcile logic landed) ends up with the wallet KV bound
 * and the profile KV empty, even when a `profiles` row with that
 * wallet already exists. Every downstream `playerKeyFor` caller then
 * computes the wallet key instead of `p:<id>`, and any row written with
 * `profile_id` set (wordmarks, streaks, leaderboard-joined solves) goes
 * invisible to that session — the bug surfaced as a leaderboard
 * showing a player's wordmark badges while the Stats → Lexicon panel
 * reported 0/17 for the same player.
 *
 * On the first read for such a session we look up the profile by
 * wallet and persist the KV binding so every subsequent request
 * (including those that don't pair both reads) picks up the profile
 * id via the cheap KV-only path.
 */
export async function resolveSessionIdentity(
  sessionId: string,
): Promise<SessionIdentity> {
  const [wallet, profileId] = await Promise.all([
    getSessionWallet(sessionId),
    getSessionProfile(sessionId),
  ]);
  if (profileId != null) {
    return { sessionId, wallet, profileId };
  }
  if (!wallet) {
    return { sessionId, wallet: null, profileId: null };
  }
  const profile = await getProfileByWallet(wallet);
  if (profile == null) {
    return { sessionId, wallet, profileId: null };
  }
  // Best-effort hydrate — a failed KV write doesn't change the return
  // value, it just means the next request will do the DB lookup again.
  try {
    await setSessionProfileOrThrow(sessionId, profile.id);
  } catch (err) {
    console.warn('[session-identity] profile hydration failed', err);
  }
  return { sessionId, wallet, profileId: profile.id };
}
