import { NextResponse } from 'next/server';
import { getStripe, STRIPE_WEBHOOK_SECRET } from '@/lib/stripe';
import { recordFiatUnlock } from '@/lib/db/queries';
import { setSessionPremium } from '@/lib/session-premium';
import { recordFunnelEvent } from '@/lib/funnel/record';
import { isValidSessionId } from '@/lib/session';
import { isValidAddress } from '@/lib/address';
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
    // Don't echo the Stripe SDK error message back — it can surface
    // internals that help an attacker iterate on forged signatures.
    // Log server-side, return a generic response.
    console.warn('[stripe/webhook] signature verification failed', err);
    return NextResponse.json({ error: 'signature verification failed' }, { status: 400 });
  }

  if (event.type !== 'checkout.session.completed') {
    return NextResponse.json({ received: true, ignored: event.type });
  }

  const session = event.data.object as Stripe.Checkout.Session;

  if (session.payment_status !== 'paid') {
    return NextResponse.json({ received: true, ignored: 'unpaid' });
  }

  const metadata = session.metadata ?? {};
  // Validate the shape of both identity fields before we use them. The
  // webhook itself is already signature-verified, so these values came
  // from Stripe — but they ultimately originated in our checkout route,
  // and we'd rather a forgotten metadata field or a dashboard-edited
  // session fail the intake than silently write a malformed row.
  const sessionId = isValidSessionId(metadata.sessionId) ? metadata.sessionId : null;
  const wallet =
    typeof metadata.wallet === 'string' && isValidAddress(metadata.wallet)
      ? metadata.wallet.toLowerCase()
      : null;

  if (!sessionId) {
    console.error('[stripe/webhook] missing or malformed sessionId in metadata', {
      stripeSessionId: session.id,
    });
    return NextResponse.json({ error: 'missing sessionId in metadata' }, { status: 500 });
  }

  try {
    if (wallet) {
      // Wallet present: bind premium to the wallet row only. Skipping
      // setSessionPremium here is intentional — if we also set the session
      // key, a second wallet could later call /api/premium/migrate and claim
      // the key, creating two premium_users rows from one payment. The wallet
      // row is the source of truth; refreshPremium on reconnect reads it.
      await recordFiatUnlock({
        stripeSessionId: session.id,
        wallet,
      });
    } else {
      // No wallet: bind premium to the browser session. The session key is
      // the only record until the user connects a wallet and migration runs.
      await setSessionPremium(sessionId, session.id);
    }
  } catch (err) {
    console.error('[stripe/webhook] failed to record unlock', err);
    return NextResponse.json({ error: 'failed to record unlock' }, { status: 500 });
  }

  // checkout_completed — idempotency key = stripe event id, so Stripe's
  // at-least-once webhook delivery can't double-count. recordFunnelEvent
  // catches its own failures internally, but it's reached through an
  // await expression, so we belt-and-suspender a try/catch here — any
  // exception surfacing as a 500 would trigger a Stripe retry storm
  // and the very double-count we're guarding against.
  try {
    await recordFunnelEvent(
      { name: 'checkout_completed', method: 'fiat' },
      { sessionId, wallet, idempotencyKey: event.id },
    );
  } catch (err) {
    console.warn('[stripe/webhook] funnel telemetry emit failed', err);
  }

  return NextResponse.json({ received: true, sessionId: session.id });
}
