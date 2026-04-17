/**
 * Revenue calculation assumptions used by the admin dashboard's Pulse
 * and Revenue views. Kept isolated so the operator can update these
 * without touching query code when pricing or fees change.
 *
 * Crypto path (M5-usdc-premium): `premium_users.usdc_amount` carries
 * the actual USDC received per unlock, so crypto revenue is computed
 * exactly from that column — this constant is only the FALLBACK when
 * `usdc_amount` is null (legacy rows from before the USDC swap ship).
 *
 * Fiat path: fixed $6 one-time price, Stripe fees follow the standard
 * US-domestic card pricing. Published net revenue applies the fee
 * formula; gross revenue does not.
 */

/** Fallback USD value assumed for a crypto unlock when `usdc_amount` is NULL. */
export const CRYPTO_FALLBACK_USD = 6;

/** Fixed fiat premium price (one-time purchase). */
export const FIAT_PRICE_USD = 6;

/** Stripe card-payment fee: 2.9% + $0.30 per successful charge (US domestic). */
export const STRIPE_FEE_PCT = 0.029;
export const STRIPE_FEE_FLAT_USD = 0.30;

/** Apply Stripe fees to a gross fiat amount → returns net received. */
export function fiatNetOf(grossUsd: number): number {
  return grossUsd - grossUsd * STRIPE_FEE_PCT - STRIPE_FEE_FLAT_USD;
}
