import { NextResponse } from 'next/server';
import { getStripe, STRIPE_WEBHOOK_SECRET } from '@/lib/stripe';
import { recordFiatUnlock } from '@/lib/db/queries';
import type Stripe from 'stripe';

/**
 * POST /api/stripe/webhook
 *
 * Stripe calls this endpoint when a checkout session completes. We
 * verify the request signature against `STRIPE_WEBHOOK_SECRET` (set via
 * `stripe listen` in dev, dashboard secret in prod) and then dispatch
 * on the event type.
 *
 * Only `checkout.session.completed` flips a premium row. Everything
 * else (payment intents, refunds, disputes) is ignored for now — dispute
 * handling lands with M4g when we wire the on-chain escrow. For the
 * M4f MVP, premium is a DB flag only; a successful chargeback would be
 * handled manually by the operator via `revokePremium` on /admin.
 *
 * CRITICAL: This route must run in the Node runtime (not Edge) because
 * `stripe.webhooks.constructEvent` needs the raw request body bytes and
 * crypto primitives that aren't available on Edge.
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

  // Stripe requires the raw body to verify the signature. Next's
  // Request.text() preserves the exact bytes, which is what we need.
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'signature verification failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (event.type !== 'checkout.session.completed') {
    // Not an error — Stripe sends many event types and we just don't
    // handle them yet. Ack with 200 so Stripe stops retrying.
    return NextResponse.json({ received: true, ignored: event.type });
  }

  const session = event.data.object as Stripe.Checkout.Session;

  // Belt-and-suspenders: only act on actually-paid sessions. A
  // completed session with `payment_status='unpaid'` can happen in
  // rare "async" payment methods (bank debits, etc.); we skip those
  // and wait for a later event that confirms payment.
  if (session.payment_status !== 'paid') {
    return NextResponse.json({ received: true, ignored: 'unpaid' });
  }

  const metadata = session.metadata ?? {};
  const wallet = typeof metadata.wallet === 'string' && metadata.wallet !== '' ? metadata.wallet : null;
  const handle = typeof metadata.handle === 'string' && metadata.handle !== '' ? metadata.handle : null;

  if (!wallet && !handle) {
    // A checkout with neither identity should never reach here because
    // the checkout route validates before creating the session. If it
    // does happen, surface loudly — dropping the row silently would
    // leave a paid-but-unattributed charge.
    return NextResponse.json(
      { error: 'session has no wallet or handle in metadata', sessionId: session.id },
      { status: 500 },
    );
  }

  try {
    await recordFiatUnlock({
      stripeSessionId: session.id,
      wallet,
      handle,
    });
  } catch (err) {
    // Log server-side so Stripe can retry. The 500 response tells
    // Stripe's retry machinery to re-deliver the event — important
    // for transient DB failures.
    console.error('[stripe/webhook] recordFiatUnlock failed', err);
    return NextResponse.json(
      { error: 'failed to record unlock' },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true, sessionId: session.id });
}
