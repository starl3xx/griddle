import { NextResponse } from 'next/server';
import { getStripe, STRIPE_PRICE_ID } from '@/lib/stripe';
import { SITE_URL } from '@/lib/site';
import { isValidAddress } from '@/lib/address';

/**
 * POST /api/stripe/checkout
 *
 * Creates a Stripe Checkout Session for Griddle Premium ($6, one-time)
 * and returns the hosted checkout URL for the client to redirect into.
 * The client POSTs one of:
 *
 *   - `{ wallet: '0x…' }` — the user has a connected wallet, so we bind
 *     the future premium row to that address. No handle needed; the
 *     leaderboard will render them by wallet with no name.
 *
 *   - `{ handle: 'alice' }` — no wallet yet; the user picked a handle in
 *     the pre-checkout form. The future profiles row will key on the
 *     handle and the wallet will be linked later if/when they connect.
 *
 * Either field is validated here (wallet = checksum regex, handle =
 * 1-32 chars trimmed). At least one must be present. Both are passed
 * through as session `metadata` so the webhook can insert the right
 * row on checkout completion.
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

  if (!wallet && !handle) {
    return NextResponse.json(
      { error: 'wallet or handle required' },
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
