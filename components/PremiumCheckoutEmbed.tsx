'use client';

import { useCallback, useMemo } from 'react';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
} from '@stripe/react-stripe-js';

/**
 * Inline Stripe Checkout for the $6 fiat premium path (M5-premium-embedded).
 *
 * The provider calls `fetchClientSecret` once on mount — it POSTs to our
 * existing `/api/stripe/checkout` with `mode: 'embedded'` and returns
 * the `client_secret` Stripe needs to hydrate the iframe. The hosted
 * fallback (`mode: 'hosted'`) is selected at the GameClient level when
 * running inside a Farcaster mini app Frame, not here.
 *
 * `onComplete` is the client-side success signal; the webhook writes
 * the `premium_users` row (wallet path) or session-premium KV key
 * (anonymous path) on its own timing. The caller polls after onComplete
 * before closing the modal so UI state lines up with the DB/KV write.
 *
 * `stripePromise` is module-scoped per Stripe's SDK guidance — creating
 * it inside the component would re-initialise the SDK on every render
 * and tear down the iframe.
 */
let stripePromise: Promise<Stripe | null> | null = null;

function getStripePromise(): Promise<Stripe | null> {
  if (stripePromise) return stripePromise;
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (!publishableKey) {
    console.error(
      '[premium-embed] NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY missing — embed will not load',
    );
    stripePromise = Promise.resolve(null);
    return stripePromise;
  }
  stripePromise = loadStripe(publishableKey);
  return stripePromise;
}

export interface PremiumCheckoutEmbedProps {
  /** Wallet to bind the unlock to, or null for anonymous session-premium. */
  wallet: string | null;
  /** Fires once Stripe confirms payment on the client. Caller is
   *  responsible for polling the premium status and closing the modal. */
  onComplete: () => void;
}

export function PremiumCheckoutEmbed({ wallet, onComplete }: PremiumCheckoutEmbedProps) {
  const fetchClientSecret = useCallback(async (): Promise<string> => {
    const res = await fetch('/api/stripe/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        wallet: wallet ?? undefined,
        mode: 'embedded',
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`checkout session failed: ${res.status} ${detail}`);
    }
    const data = (await res.json()) as { clientSecret?: string };
    if (!data.clientSecret) {
      throw new Error('checkout session returned no clientSecret');
    }
    return data.clientSecret;
  }, [wallet]);

  const options = useMemo(
    () => ({ fetchClientSecret, onComplete }),
    [fetchClientSecret, onComplete],
  );

  return (
    <EmbeddedCheckoutProvider stripe={getStripePromise()} options={options}>
      <EmbeddedCheckout />
    </EmbeddedCheckoutProvider>
  );
}
