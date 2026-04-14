import { NextResponse } from 'next/server';
import { getStripe, STRIPE_WEBHOOK_SECRET } from '@/lib/stripe';
import { recordFiatUnlock } from '@/lib/db/queries';
import { setSessionPremium } from '@/lib/session-premium';
import type Stripe from 'stripe';

/**
 * POST /api/stripe/webhook
 *
 * Handles Stripe events. On `checkout.session.completed`:
 *
 *   1. Sets `griddle:session-premium:{sessionId}` in Upstash so the
 *      buyer's current browser tab sees premium immediately (even
 *      without a wallet connected).
 *
 *   2. If metadata includes a `wallet`, also inserts a `premium_users`
 *      row via `recordFiatUnlock` so the wallet-keyed premium check
 *      works for connected users without requiring a migration step.
 *
 * The session id in metadata was set by the checkout route server-side
 * from the `x-session-id` header — it matches the buyer's current
 * browser session, so the KV write is immediately visible to their
 * next page load.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<NextResponse> {
  if (!STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json(
      { error: 'STRIPE_WEBHOOK_SECRET not configured' },
      { status: 503 },
    );
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'missing stripe-signature header' }, { status: 400 });
  }

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'signature verification failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (event.type !== 'checkout.session.completed') {
    return NextResponse.json({ received: true, ignored: event.type });
  }

  const session = event.data.object as Stripe.Checkout.Session;

  if (session.payment_status !== 'paid') {
    return NextResponse.json({ received: true, ignored: 'unpaid' });
  }

  const metadata = session.metadata ?? {};
  const sessionId = typeof metadata.sessionId === 'string' && metadata.sessionId !== ''
    ? metadata.sessionId
    : null;
  const wallet = typeof metadata.wallet === 'string' && metadata.wallet !== ''
    ? metadata.wallet
    : null;

  if (!sessionId) {
    // sessionId should always be present — checkout route always sets it.
    // If missing, log loudly and return 500 so Stripe retries.
    console.error('[stripe/webhook] missing sessionId in metadata', { stripeSessionId: session.id });
    return NextResponse.json({ error: 'missing sessionId in metadata' }, { status: 500 });
  }

  try {
    // Always bind premium to the browser session first — works regardless
    // of whether a wallet is connected.
    await setSessionPremium(sessionId, session.id);

    // If a wallet was connected at checkout time, also write premium_users
    // so the wallet-keyed check works without a separate migration step.
    if (wallet) {
      await recordFiatUnlock({
        stripeSessionId: session.id,
        wallet,
      });
    }
  } catch (err) {
    console.error('[stripe/webhook] failed to record unlock', err);
    return NextResponse.json({ error: 'failed to record unlock' }, { status: 500 });
  }

  return NextResponse.json({ received: true, sessionId: session.id });
}
