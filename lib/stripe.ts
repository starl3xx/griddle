import Stripe from 'stripe';

/**
 * Stripe server client. Used by `/api/stripe/checkout` (session create)
 * and `/api/stripe/webhook` (signature verify + event handling).
 *
 * Lazy singleton — constructed on first access, not at module load,
 * because Next 14's build-time page data collection imports this file
 * without env vars populated. Throwing at import would break `bun build`
 * even though the routes are fine at runtime on Vercel.
 */

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    throw new Error(
      'STRIPE_SECRET_KEY is not set. Add it to .env.local (from the Stripe dashboard).',
    );
  }
  _stripe = new Stripe(secret, {
    // Pin the API version so a future Stripe rollover can't break the
    // webhook payload shape without us noticing. Bump deliberately after
    // testing against the new version in staging.
    apiVersion: '2026-03-25.dahlia',
    typescript: true,
  });
  return _stripe;
}

/**
 * The Stripe Price id for Griddle Premium fiat checkout. Created in the
 * Stripe dashboard as a one-time $6 charge with lookup key
 * `griddle_premium_v1`. Set in env so dev / staging / prod can point at
 * different test vs live prices without code changes.
 */
export const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID ?? '';

/**
 * Webhook signing secret from Stripe CLI (`stripe listen`) in dev, and
 * the `whsec_...` value from the Stripe dashboard in prod. Verified on
 * every webhook request; a missing or mismatched secret rejects the
 * request with a 400 before any DB writes happen.
 */
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? '';
