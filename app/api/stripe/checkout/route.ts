import { NextResponse } from 'next/server';
import { getStripe, STRIPE_PRICE_ID } from '@/lib/stripe';
import { SITE_URL } from '@/lib/site';
import { isValidAddress } from '@/lib/address';
import { getSessionId } from '@/lib/session';

/**
 * POST /api/stripe/checkout
 *
 * Creates a Stripe Checkout Session for Griddle Premium ($6, one-time)
 * and returns the hosted checkout URL. No wallet required — premium
 * binds to the browser session first, then migrates to a wallet on
 * first connect.
 *
 * The server reads the session id from the `x-session-id` header (set
 * by middleware on every request) and stores it in the Stripe session
 * metadata. The webhook uses it to set `griddle:session-premium:{sid}`
 * in Upstash, which GameClient checks on every page load.
 *
 * If a wallet IS connected, it's also stored in metadata so the webhook
 * can simultaneously write a `premium_users` row — skipping the
 * migration step for wallet-connected buyers.
 *
 * Apple Pay surfaces automatically via `payment_method_types: ['card']`
 * on eligible devices.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CheckoutRequestBody {
  wallet?: string;
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!STRIPE_PRICE_ID) {
    return NextResponse.json(
      { error: 'STRIPE_PRICE_ID not configured' },
      { status: 503 },
    );
  }

  let body: CheckoutRequestBody;
  try {
    body = (await req.json()) as CheckoutRequestBody;
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }

  const wallet = body.wallet && isValidAddress(body.wallet)
    ? body.wallet.toLowerCase()
    : null;

  // Read session id server-side — middleware guarantees it's present.
  const sessionId = await getSessionId();

  const session = await getStripe().checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
    payment_method_types: ['card'],
    metadata: {
      sessionId,
      wallet: wallet ?? '',
    },
    success_url: `${SITE_URL}/premium/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${SITE_URL}/?premium=cancelled`,
  });

  if (!session.url) {
    return NextResponse.json(
      { error: 'stripe did not return a checkout url' },
      { status: 502 },
    );
  }

  return NextResponse.json({ url: session.url, sessionId: session.id });
}
