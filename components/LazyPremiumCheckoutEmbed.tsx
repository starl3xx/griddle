'use client';

import { PremiumCheckoutEmbed, type PremiumCheckoutEmbedProps } from './PremiumCheckoutEmbed';

/**
 * Dynamic-import entry point for the embedded Stripe Checkout flow.
 * Mirrors LazyPremiumCryptoFlow so PremiumGateModal loads the Stripe
 * SDK chunk (~50 kB) only when a user actually opens the fiat unlock
 * step inside the modal.
 *
 * The real `next/dynamic` boundary lives at the modal import site —
 * this file exists so the module path is stable and the default
 * export is ready to swap out if we ever need to wrap it.
 */
export default function LazyPremiumCheckoutEmbed(props: PremiumCheckoutEmbedProps) {
  return <PremiumCheckoutEmbed {...props} />;
}
