import { NextResponse } from 'next/server';
import { getStripe, STRIPE_PRICE_ID } from '@/lib/stripe';
import { SITE_URL } from '@/lib/site';
import { isValidAddress } from '@/lib/address';

/**
 * POST /api/stripe/checkout
 *
 * Creates a Stripe Checkout Session for Griddle Premium ($6, one-time)
 * and returns the hosted checkout URL for the client to redirect into.
 * The client POSTs `{ wallet: '0x…' }` — a connected wallet is REQUIRED
 * to hit this endpoint in M4f. Rationale: the game's premium gate reads
 * from `/api/premium/[wallet]` which queries `premium_users` keyed on
 * wallet. A handle-only buyer has no wallet, so even a successful
 * charge wouldn't flip their UI to premium — they'd pay and get
 * nothing. The full handle-identity premium read path (profiles-table
 * lookup, wallet-handle merge on connect, the free-with-account stats
 * carrot, etc.) lands in the follow-up M4g PR. Until then, fiat
 * checkout enforces the wallet requirement up front.
 *
 * The `handle` field is accepted and forwarded as metadata so the
 * follow-up PR can enable the handle path without changing the wire
 * format, but a missing wallet is still rejected with 400 here.
 *
 * Apple Pay is enabled by configuring the Checkout Session with
 * `payment_method_types: ['card']` — Stripe auto-surfaces Apple Pay
 * on eligible devices with no extra work on our end.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CheckoutRequestBody {
  wallet?: string;
  handle?: string;
}

function normalizeHandle(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 32) return null;
  // Allow letters, numbers, underscore, hyphen. This is more permissive
  // than a strict handle regex but the real uniqueness guard is the DB
  // partial index on lower(handle) — here we just block obvious junk.
  if (!/^[A-Za-z0-9_\-]+$/.test(trimmed)) return null;
  return trimmed;
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
  const handle = normalizeHandle(body.handle);

  // M4f scope: a connected wallet is REQUIRED for fiat checkout. The
  // premium-read path only hits `premium_users` by wallet; without
  // a wallet binding a successful payment would leave the buyer
  // permanently gated. Handle-only checkout unlocks in M4g.
  if (!wallet) {
    return NextResponse.json(
      { error: 'wallet required — connect before checkout' },
      { status: 400 },
    );
  }

  // The success URL appends the Stripe session id so the post-redirect
  // page can poll `/api/premium/[wallet]` (or a handle-equivalent) until
  // the webhook lands and flips the DB. `{CHECKOUT_SESSION_ID}` is a
  // Stripe placeholder that gets substituted on redirect.
  const session = await getStripe().checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
    payment_method_types: ['card'],
    // Metadata is what the webhook reads to figure out who paid. Keep
    // both fields even if only one is set — the webhook handles the
    // null branches.
    metadata: {
      wallet: wallet ?? '',
      handle: handle ?? '',
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
