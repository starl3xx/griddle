import { NextResponse } from 'next/server';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { solves, profiles } from '@/lib/db/schema';
import { getSessionId } from '@/lib/session';
import { isValidAddress } from '@/lib/address';
import { setSessionWallet, clearSessionWallet } from '@/lib/wallet-session';
import { getSessionProfile, setSessionProfileOrThrow } from '@/lib/session-profile';
import { mergeProfiles } from '@/lib/db/queries';

/**
 * POST /api/wallet/link
 *
 * Body: `{ wallet: "0x..." }`
 *
 * Retroactively attributes all anonymous solves on the current session
 * to the given wallet. This runs once when a user connects their
 * wallet for the first time on a session — every solve they made
 * before connecting becomes wallet-attributed.
 *
 * Sets `solves.wallet = ?` for rows where `session_id = current` AND
 * `wallet IS NULL`. Existing wallet attributions are NOT overwritten
 * (defensive against a session that's already been linked to a
 * different wallet, which shouldn't happen but isn't worth crashing on).
 *
 * In M5-premium-checkout when the premium burn lands, this same endpoint will also
 * trigger a stream of leaderboard recomputes. For M5-wallets it's pure
 * backfill — no other side effects.
 *
 * Note: this endpoint accepts the wallet from the request body without
 * verification (no signature). That's intentional for M5-wallets — wallet
 * authentication via SIWE / signed message can come in M5 if we ever
 * need to prove ownership beyond "the user told us." The risk surface
 * is "user A claims wallet B's anonymous solves," which is a credit
 * theft of work the legitimate wallet owner never did anyway. Low
 * stakes; not worth the extra signing dance pre-launch.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<NextResponse> {
  let body: { wallet?: string };
  try {
    body = (await req.json()) as { wallet?: string };
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  if (!body.wallet || !isValidAddress(body.wallet)) {
    return NextResponse.json({ error: 'invalid wallet address' }, { status: 400 });
  }

  const sessionId = await getSessionId();
  const normalized = body.wallet.toLowerCase();

  // Two writes, one purpose: (1) backfill historical anonymous solves
  // for this session, (2) bind the session to this wallet so FUTURE
  // solves on /api/solve get attributed automatically.
  const [result] = await Promise.all([
    db
      .update(solves)
      .set({ wallet: normalized })
      .where(and(eq(solves.sessionId, sessionId), isNull(solves.wallet)))
      .returning({ id: solves.id }),
    setSessionWallet(sessionId, normalized),
  ]);

  // Reconcile profile identity. Four cases based on whether the session
  // has a pre-existing profile binding (from an earlier handle-only or
  // magic-link flow) and whether this wallet already owns a profile
  // row in the DB:
  //
  //   a) neither → nothing to do (premium unlock creates one later)
  //   b) session only → UPDATE that profile to carry this wallet
  //   c) wallet only → bind session to the existing wallet profile
  //   d) both, same id → nothing to do (already reconciled)
  //   e) both, different ids → mergeProfiles() atomic CTE; session
  //      rebinds to the merged survivor
  //
  // Without this, a user who creates a handle profile, then connects a
  // wallet, ends up with two separate profile rows — the session one
  // has no wallet, the wallet one has no handle/email, and the premium
  // ledger never links up with the user's solve history.
  try {
    const sessionProfileId = await getSessionProfile(sessionId);
    const walletProfileRows = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.wallet, normalized))
      .limit(1);
    const walletProfileId = walletProfileRows[0]?.id ?? null;

    if (sessionProfileId != null && walletProfileId == null) {
      // Case (b): session profile exists but has no wallet yet.
      // Attach it to this wallet with a direct UPDATE. Catch unique-
      // constraint violations just in case (shouldn't fire since we
      // just confirmed no wallet profile exists, but another request
      // could race us between the SELECT and the UPDATE).
      try {
        await db
          .update(profiles)
          .set({ wallet: normalized, updatedAt: new Date() })
          .where(eq(profiles.id, sessionProfileId));
      } catch {/* racing wallet-profile; fall through — next connect resolves it */}
    } else if (sessionProfileId == null && walletProfileId != null) {
      // Case (c): wallet profile exists but the session isn't yet
      // bound. Bind it so /api/profile reads return this row.
      await setSessionProfileOrThrow(sessionId, walletProfileId);
    } else if (
      sessionProfileId != null &&
      walletProfileId != null &&
      sessionProfileId !== walletProfileId
    ) {
      // Case (e): two distinct profiles for the same user. Merge
      // atomically and rebind the session to the survivor.
      const merged = await mergeProfiles(sessionProfileId, walletProfileId);
      await setSessionProfileOrThrow(sessionId, merged.id);
    }
  } catch (err) {
    // Reconcile is best-effort — if it fails, the legacy path (read
    // from session-wallet fallback in /api/profile) still serves the
    // wallet profile. Log for observability.
    console.warn('[wallet/link] profile reconcile failed', err);
  }

  // Intentionally do NOT include sessionId in the response. The session
  // cookie is httpOnly precisely so client-side JS can't read it; echoing
  // it in the response body would defeat that protection and let any
  // script on the page (including via XSS) lift the session id.
  return NextResponse.json({
    wallet: normalized,
    linked: result.length,
  });
}

/**
 * DELETE /api/wallet/link
 *
 * Clears the session → wallet binding. Called when the user disconnects
 * their wallet so subsequent solves on the same session aren’t silently
 * attributed to the just-disconnected wallet.
 *
 * Does NOT touch existing `solves.wallet` rows — historical attributions
 * stay put. Only the forward-looking binding is cleared.
 */
export async function DELETE(): Promise<NextResponse> {
  const sessionId = await getSessionId();
  await clearSessionWallet(sessionId);
  return NextResponse.json({ ok: true });
}
