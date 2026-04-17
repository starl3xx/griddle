import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getOrCreateProfileByEmail, mergeProfiles } from '@/lib/db/queries';
import { db } from '@/lib/db/client';
import { profiles } from '@/lib/db/schema';
import { verifyOtp } from '@/lib/auth/otp';
import { getSessionId } from '@/lib/session';
import { setSessionProfileOrThrow } from '@/lib/session-profile';
import { getSessionWallet } from '@/lib/wallet-session';

/**
 * POST /api/auth/verify-code
 *
 * Body: `{ email: string, code: string }`
 *
 * Companion endpoint to GET /api/auth/verify (the magic-link path).
 * Verifies a 6-digit OTP that was emailed alongside the magic link,
 * giving PWA users a way to sign in without leaving the PWA — tapping
 * the link in their email opens the default browser, which carries a
 * different session cookie from the installed app.
 *
 * On success the session → profile binding runs identically to
 * /api/auth/verify, including the wallet-session merge path. On
 * failure returns `{ error }` with a 400 so the UI can show an
 * inline "invalid or expired code" message without a redirect.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Body {
  email?: string;
  code?: string;
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const email = (body.email ?? '').trim().toLowerCase();
  const code = (body.code ?? '').trim();
  if (!email || !EMAIL_RE.test(email) || email.length > 254) {
    return NextResponse.json({ error: 'valid email required' }, { status: 400 });
  }
  if (!/^[0-9]{6}$/.test(code)) {
    return NextResponse.json({ error: 'enter the 6-digit code' }, { status: 400 });
  }

  const ok = await verifyOtp(email, code);
  if (!ok) {
    return NextResponse.json(
      { error: 'Invalid or expired code.' },
      { status: 400 },
    );
  }

  const emailProfile = await getOrCreateProfileByEmail(email);

  try {
    const sessionId = await getSessionId();
    let finalProfileId = emailProfile.id;

    // Same wallet-session merge rules as GET /api/auth/verify — if a
    // wallet is already bound to the session, reconcile the two
    // profile rows instead of silently creating a second one.
    const sessionWallet = await getSessionWallet(sessionId);
    if (sessionWallet) {
      const walletRows = await db
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.wallet, sessionWallet))
        .limit(1);
      const walletProfileId = walletRows[0]?.id ?? null;
      if (walletProfileId && walletProfileId !== emailProfile.id) {
        const merged = await mergeProfiles(emailProfile.id, walletProfileId);
        finalProfileId = merged.id;
      }
    }

    await setSessionProfileOrThrow(sessionId, finalProfileId);
  } catch (err) {
    console.error('[auth/verify-code] setSessionProfile / merge failed', err);
    return NextResponse.json(
      { error: 'Sign-in succeeded but session binding failed. Please retry.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
