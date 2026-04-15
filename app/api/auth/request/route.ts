import { NextResponse } from 'next/server';
import { createMagicLink } from '@/lib/db/queries';
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
    return NextResponse.json({ error: 'Failed to send email' }, { status: 502 });
  }

  return NextResponse.json({ sent: true });
}
