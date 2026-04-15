import { NextResponse } from 'next/server';
import { createMagicLink, deleteMagicLink } from '@/lib/db/queries';
import { sendMagicLink, isEmailConfigured } from '@/lib/resend';

/**
 * POST /api/auth/request
 *
 * Body: `{ email: string }`
 *
 * Sends a magic link to the given email. Rate-limited to 5 requests
 * per email per hour. Returns `{ sent: true }` on success (intentionally
 * not revealing whether the email exists).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request): Promise<NextResponse> {
  if (!isEmailConfigured()) {
    return NextResponse.json({ error: 'Email not configured' }, { status: 503 });
  }

  let body: { email?: string };
  try {
    body = (await req.json()) as { email?: string };
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const email = (body.email ?? '').trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email) || email.length > 254) {
    return NextResponse.json({ error: 'valid email required' }, { status: 400 });
  }

  const result = await createMagicLink(email);
  if ('error' in result) {
    const status = result.error.startsWith('Too many') ? 429 : 500;
    return NextResponse.json({ error: result.error }, { status });
  }

  const { success, error } = await sendMagicLink(email, result.token);
  if (!success) {
    console.error('[auth/request] sendMagicLink failed:', error);
    // Roll back the just-inserted token row so a failed email send
    // doesn't burn one of the 5 hourly rate-limit slots. Without this,
    // five consecutive Resend outages would lock the user out for an
    // hour with zero emails received. Best-effort — if the delete
    // itself fails, the slot is lost but the user still gets the 502.
    try {
      await deleteMagicLink(result.token);
    } catch (delErr) {
      console.error('[auth/request] rollback delete failed:', delErr);
    }
    return NextResponse.json({ error: 'Failed to send email' }, { status: 502 });
  }

  return NextResponse.json({ sent: true });
}
