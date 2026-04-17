/**
 * Revenue calculation assumptions used by the admin dashboard's Pulse
 * and Revenue views. Kept isolated so the operator can update these
 * without touching query code when pricing changes.
 *
 * Crypto path (M5-usdc-premium): `premium_users.usdc_amount` carries
 * the actual USDC received per unlock, so crypto revenue is computed
 * exactly from that column — this constant is only the FALLBACK when
 * `usdc_amount` is null (legacy rows from before the USDC swap ship).
 *
 * Fiat path: fixed $6 one-time price.
 */

/** Fallback USD value assumed for a crypto unlock when `usdc_amount` is NULL. */
export const CRYPTO_FALLBACK_USD = 6;

/** Fixed fiat premium price (one-time purchase). */
export const FIAT_PRICE_USD = 6;
