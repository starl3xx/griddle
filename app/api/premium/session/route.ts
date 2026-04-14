import { NextResponse } from 'next/server';
import { getSessionId } from '@/lib/session';
import { getSessionPremium } from '@/lib/session-premium';

/**
 * GET /api/premium/session
 *
 * Returns `{ premium: boolean, stripeSessionId?: string }` for the
 * current browser session. Used by GameClient on page load to show
 * premium features for fiat buyers who haven't connected a wallet yet.
 *
 * The session id is read from the `x-session-id` header — set by
 * middleware on every request, never comes from the client body.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const sessionId = await getSessionId();
  const value = await getSessionPremium(sessionId);

  if (!value) {
    return NextResponse.json({ premium: false });
  }

  return NextResponse.json({ premium: true, stripeSessionId: value.stripeSessionId });
}
