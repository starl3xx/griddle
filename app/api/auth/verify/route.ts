import { NextResponse } from 'next/server';
import { verifyMagicLink, getOrCreateProfileByEmail } from '@/lib/db/queries';
import { getSessionId } from '@/lib/session';
import { setSessionProfileOrThrow } from '@/lib/session-profile';
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

  const profile = await getOrCreateProfileByEmail(verifyResult.email);

  // Bind the profile to the browser session. This MUST succeed or the
  // user is stranded with a consumed (single-use) magic-link token and
  // no session binding — on reload /api/profile returns null and the
  // UI re-renders the anonymous CTA. Using the throwing variant so a
  // KV flake surfaces as /?auth=error (the client shows a retry
  // message) instead of silently redirecting to /?auth=ok.
  try {
    const sessionId = await getSessionId();
    await setSessionProfileOrThrow(sessionId, profile.id);
  } catch (err) {
    console.error('[auth/verify] setSessionProfile failed after token consume', err);
    return NextResponse.redirect(fail);
  }

  return NextResponse.redirect(ok);
}
