import { NextResponse } from 'next/server';
import { getStripe, STRIPE_PRICE_ID } from '@/lib/stripe';
import { SITE_URL } from '@/lib/site';
import { isValidAddress } from '@/lib/address';
import { getSessionId } from '@/lib/session';
import { getSessionProfile } from '@/lib/session-profile';
import { getSessionWallet } from '@/lib/wallet-session';
import { db } from '@/lib/db/client';
import { profiles } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { isValidEmail } from '@/lib/email';

/**
 * POST /api/stripe/checkout
 *
 * Creates a Stripe Checkout Session for Griddle Premium ($6, one-time)
 * and returns either a `clientSecret` (embedded, default) or a hosted
 * `url`. Embedded mode renders the Stripe form inside an iframe on
 * griddle.fun so the user never leaves the app (and the Farcaster mini
 * app Frame doesn't break on full-page navigation). Hosted mode stays
 * as a fallback for contexts where embedded is blocked — selected by
 * the client when `inMiniApp === true` or via `mode: 'hosted'` body.
 *
 * No wallet required — premium binds to the browser session first,
 * then migrates to a wallet on first connect. Session id comes from
 * the `x-session-id` header (set by middleware on every request) and
 * is stored in the Stripe session metadata; the webhook uses it to
 * set `griddle:session-premium:{sid}` in Upstash for anonymous buyers.
 *
 * If a wallet IS connected, it's also stored in metadata so the webhook
 * can simultaneously write a `premium_users` row — skipping the
 * migration step for wallet-connected buyers.
 *
 * `automatic_payment_methods: { enabled: true }` surfaces Apple Pay,
 * Google Pay, and Link automatically on eligible devices now that
 * griddle.fun domain verification is complete in the Stripe dashboard.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CheckoutMode = 'embedded' | 'hosted';

interface CheckoutRequestBody {
  wallet?: string;
  mode?: CheckoutMode;
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
  const mode: CheckoutMode = body.mode === 'hosted' ? 'hosted' : 'embedded';

  const sessionId = await getSessionId();

  // Prefill email when the user is already signed in. Resolve by
  // session→profile binding first (magic-link / email-auth users),
  // then fall back to the wallet→profile lookup. If nothing binds,
  // leave customer_email unset and Stripe will still require the user
  // to enter it on the checkout page.
  const prefillEmail = await resolvePrefillEmail(sessionId, wallet);

  // Both modes share everything but ui_mode + completion routing.
  // Session metadata is the identity layer for the webhook; it must
  // not differ between modes or the fiat unlock path becomes
  // mode-dependent.
  //
  // Explicit method whitelist rather than automatic_payment_methods:
  // ['card'] (covers Apple Pay + Google Pay as wrappers, synchronous)
  // plus ['link'] (Stripe's saved-card wallet, synchronous). All three
  // new methods surface in-embed now that griddle.fun domain verification
  // is complete, and every method in the list settles synchronously —
  // `checkout.session.completed` fires with `payment_status: 'paid'`,
  // matching the webhook's current contract. automatic_payment_methods
  // would also surface delayed-notification methods (ACH, SEPA, Boleto)
  // that complete via the later `async_payment_succeeded` event, which
  // the webhook does NOT handle.
  // `customer_creation: 'always'` ensures Stripe creates a durable
  // Customer object for every checkout, and `customer_email` prefills
  // the email field when we already know it. Users can override the
  // prefilled value — we treat `session.customer_details.email` in the
  // webhook as source of truth, not the metadata. This makes email a
  // hard anchor even for anonymous buyers: the webhook always has
  // somewhere to read it from.
  const sharedParams = {
    mode: 'payment' as const,
    line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
    payment_method_types: ['card', 'link'] as Array<'card' | 'link'>,
    customer_creation: 'always' as const,
    ...(prefillEmail ? { customer_email: prefillEmail } : {}),
    metadata: {
      sessionId,
      wallet: wallet ?? '',
    },
  };

  if (mode === 'embedded') {
    // `redirect_on_completion: 'if_required'` keeps 3DS/bank-redirect
    // flows working (they land on return_url) while cards resolve
    // in-embed so onComplete fires without navigating away. return_url
    // is reused as the confirmation landing for both the redirect case
    // and the hosted fallback below — one success page, one polling
    // path, less divergence.
    // Stripe API version 2026-03-25.dahlia renamed ui_mode values:
    // 'embedded' → 'embedded_page', 'hosted' → 'hosted_page'. We stay
    // on 'embedded_page' here; the default (hosted_page) is what the
    // fallback branch below relies on.
    const session = await getStripe().checkout.sessions.create({
      ...sharedParams,
      ui_mode: 'embedded_page',
      redirect_on_completion: 'if_required',
      return_url: `${SITE_URL}/premium/success?session_id={CHECKOUT_SESSION_ID}${wallet ? `&wallet=${wallet}` : ''}`,
    });

    if (!session.client_secret) {
      return NextResponse.json(
        { error: 'stripe did not return a client secret' },
        { status: 502 },
      );
    }

    return NextResponse.json({
      mode: 'embedded' as const,
      clientSecret: session.client_secret,
      sessionId: session.id,
    });
  }

  // Hosted fallback. Used when the client signals it can't render the
  // embed (Farcaster mini app today; other iframe-restricted hosts in
  // future). Preserves the pre-M5-premium-embedded behaviour exactly.
  const session = await getStripe().checkout.sessions.create({
    ...sharedParams,
    success_url: `${SITE_URL}/premium/success?session_id={CHECKOUT_SESSION_ID}${wallet ? `&wallet=${wallet}` : ''}`,
    cancel_url: `${SITE_URL}/?premium=cancelled`,
  });

  if (!session.url) {
    return NextResponse.json(
      { error: 'stripe did not return a checkout url' },
      { status: 502 },
    );
  }

  return NextResponse.json({
    mode: 'hosted' as const,
    url: session.url,
    sessionId: session.id,
  });
}

/**
 * Look up the best email we can prefill into Stripe Checkout. Returns
 * null when no profile is bound to the session + wallet — in that case
 * Stripe's built-in required email field collects it.
 *
 * Preference order:
 *   1. session → profile binding (magic-link / email-auth users)
 *   2. wallet  → profile.email when the session has a connected wallet
 *
 * Falls back silently on DB errors; a prefill miss is a UX degradation,
 * not a correctness bug (email still gets collected on the Stripe page).
 */
async function resolvePrefillEmail(
  sessionId: string,
  wallet: string | null,
): Promise<string | null> {
  try {
    const profileId = await getSessionProfile(sessionId);
    if (profileId !== null) {
      const rows = await db
        .select({ email: profiles.email })
        .from(profiles)
        .where(eq(profiles.id, profileId))
        .limit(1);
      const email = rows[0]?.email ?? null;
      if (email && isValidEmail(email)) return email;
    }

    // No session→profile binding. Try wallet→profile if a wallet is
    // both connected AND bound to the session (don't trust the client-
    // supplied wallet alone — the checkout route doesn't authenticate
    // the wallet ownership).
    const sessionWallet = await getSessionWallet(sessionId);
    const trusted = sessionWallet ?? (wallet === sessionWallet ? wallet : null);
    if (trusted) {
      const rows = await db
        .select({ email: profiles.email })
        .from(profiles)
        .where(eq(profiles.wallet, trusted))
        .limit(1);
      const email = rows[0]?.email ?? null;
      if (email && isValidEmail(email)) return email;
    }
  } catch (err) {
    console.warn('[stripe/checkout] resolvePrefillEmail failed — continuing without prefill', err);
  }
  return null;
}
