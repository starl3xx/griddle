import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { verifyMagicLink, getOrCreateProfileByEmail, mergeProfiles } from '@/lib/db/queries';
import { db } from '@/lib/db/client';
import { profiles } from '@/lib/db/schema';
import { getSessionId } from '@/lib/session';
import { setSessionProfileOrThrow } from '@/lib/session-profile';
import { getSessionWallet } from '@/lib/wallet-session';
import { SITE_URL } from '@/lib/site';

/**
 * GET /api/auth/verify?token=...
 *
 * Verifies a magic link token. On success:
 *   1. Marks the token used (prevents replay).
 *   2. Gets or creates a profile keyed on the email.
 *   3. Binds the profile id to the browser's session in Upstash KV.
 *   4. Redirects to / with `?auth=ok` so GameClient can show a welcome.
 *
 * On failure: redirects to / with `?auth=error` so the UI can show an
 * error message. Never exposes the token in the redirect URL.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');

  const ok = `${SITE_URL}/?auth=ok`;
  const fail = `${SITE_URL}/?auth=error`;

  if (!token) {
    return NextResponse.redirect(fail);
  }

  const verifyResult = await verifyMagicLink(token);
  if ('error' in verifyResult) {
    return NextResponse.redirect(fail);
  }

  const emailProfile = await getOrCreateProfileByEmail(verifyResult.email);

  // Bind the profile to the browser session. This MUST succeed or the
  // user is stranded with a consumed (single-use) magic-link token and
  // no session binding — on reload /api/profile returns null and the
  // UI re-renders the anonymous CTA. Using the throwing variant so a
  // KV flake surfaces as /?auth=error (the client shows a retry
  // message) instead of silently redirecting to /?auth=ok.
  //
  // Additionally: if this session is already bound to a wallet (i.e.
  // the user connected a wallet first and is now adding an email),
  // reconcile the two profile rows. Without this, the email path
  // would silently create a second profile and rebind the session to
  // it, orphaning the user's solves, streaks, and premium ledger on
  // the wallet-linked row.
  try {
    const sessionId = await getSessionId();
    let finalProfileId = emailProfile.id;

    const sessionWallet = await getSessionWallet(sessionId);
    if (sessionWallet) {
      const walletRows = await db
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.wallet, sessionWallet))
        .limit(1);
      const walletProfileId = walletRows[0]?.id ?? null;
      if (walletProfileId && walletProfileId !== emailProfile.id) {
        // Merge the two rows atomically. mergeProfiles keeps the
        // older row (survivor) and copies any non-null fields from
        // the newer row onto it — so the user's solves, streaks,
        // and premium_users row (all keyed on the wallet that's
        // already on the survivor) stay intact, and the fresh
        // email/emailVerifiedAt get adopted.
        const merged = await mergeProfiles(emailProfile.id, walletProfileId);
        finalProfileId = merged.id;
      }
    }

    await setSessionProfileOrThrow(sessionId, finalProfileId);
  } catch (err) {
    console.error('[auth/verify] setSessionProfile / merge failed after token consume', err);
    return NextResponse.redirect(fail);
  }

  return NextResponse.redirect(ok);
}
