'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
 *
 * Failure modes are rendered in-place as a visible fallback so silent
 * blank-modal bugs (missing env var, Stripe.js CDN failure, failed
 * `/api/stripe/checkout`) can't mask themselves behind the
 * EmbeddedCheckoutProvider's own render-nothing-on-error behaviour.
 */

const PUBLISHABLE_KEY_MISSING =
  'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY missing — embed cannot load';

let stripePromise: Promise<Stripe | null> | null = null;

function getStripePromise(): Promise<Stripe | null> | null {
  if (stripePromise) return stripePromise;
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (!publishableKey) {
    return null;
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
  const stripe = getStripePromise();
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchClientSecret = useCallback(async (): Promise<string> => {
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          wallet: wallet ?? undefined,
          mode: 'embedded',
        }),
      });
      if (!res.ok) {
        // The route returns JSON ({ error: string }) on failure, so
        // `res.text()` alone would surface the JSON wrapper in the
        // error panel instead of the message itself. Try to parse and
        // pull .error, fall back to the raw text, and finally to a
        // generic suffix if the body is empty or unreadable.
        const raw = await res.text().catch(() => '');
        let detail = '';
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as { error?: unknown };
            if (typeof parsed.error === 'string' && parsed.error) {
              detail = parsed.error;
            } else {
              detail = raw;
            }
          } catch {
            detail = raw;
          }
        }
        const message = `Checkout setup failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`;
        setFetchError(message);
        throw new Error(message);
      }
      const data = (await res.json()) as { clientSecret?: string };
      if (!data.clientSecret) {
        const message = 'Checkout session returned no client secret';
        setFetchError(message);
        throw new Error(message);
      }
      return data.clientSecret;
    } catch (err) {
      // Stripe swallows a rejected fetchClientSecret — without this
      // state mirror, the embed just silently renders nothing.
      const message = err instanceof Error ? err.message : String(err);
      setFetchError((prev) => prev ?? message);
      throw err;
    }
  }, [wallet]);

  const options = useMemo(
    () => ({ fetchClientSecret, onComplete }),
    [fetchClientSecret, onComplete],
  );

  // Surface the missing-env case loudly. Without this, users see a
  // blank modal body and have no way to self-diagnose.
  if (!stripe) {
    return <EmbedError title="Card checkout unavailable" detail={PUBLISHABLE_KEY_MISSING} />;
  }

  return (
    <>
      {fetchError && <EmbedError title="Couldn’t start checkout" detail={fetchError} />}
      <div style={{ display: fetchError ? 'none' : undefined }}>
        <EmbeddedCheckoutProvider stripe={stripe} options={options}>
          <EmbeddedCheckout />
        </EmbeddedCheckoutProvider>
      </div>
    </>
  );
}

function EmbedError({ title, detail }: { title: string; detail: string }) {
  useEffect(() => {
    console.error('[premium-embed]', title, detail);
  }, [title, detail]);
  return (
    <div className="rounded-md border border-error-200 bg-error-50 dark:bg-error-900/20 p-4 text-sm">
      <p className="font-semibold text-error-700 dark:text-error-200">{title}</p>
      <p className="mt-1 text-error-700/80 dark:text-error-200/80 break-words">{detail}</p>
      <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
        Try again in a moment, or contact support if this keeps happening.
      </p>
    </div>
  );
}
