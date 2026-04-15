/**
 * Funnel event catalog — the single source of truth for what events
 * exist and what variant fields each carries. Discriminated union on
 * `name` means typos become type errors at every call site.
 *
 * Adding an event: add a new variant here. Renaming an event: just
 * rename. Historical rows keep their old event_name string and remain
 * queryable — we don't back-fill or migrate.
 *
 * Metadata lives on each variant (not jsonb-blob) so the call site
 * gets autocomplete and the admin rollup can rely on field shape.
 */

export type FunnelEvent =
  /**
   * StatsModal opened. `variant` reveals which state the user saw
   * (anonymous CTA, free account, premium) — drives the top-of-funnel
   * denominator for "who sees the upgrade path at all."
   */
  | { name: 'stats_opened'; variant: 'anon' | 'account' | 'premium' }
  /** PremiumGateModal mounted for a feature-specific gate. */
  | { name: 'premium_gate_shown'; feature: 'leaderboard' | 'archive' | 'premium' }
  /** User clicked an unlock button in the premium gate. */
  | { name: 'upgrade_clicked'; method: 'crypto' | 'fiat' }
  /** Checkout session created (fiat) or crypto permit-burn initiated. */
  | { name: 'checkout_started'; method: 'crypto' | 'fiat' }
  /**
   * Checkout successfully completed. Emitted server-side (Stripe
   * webhook / on-chain tx confirmation) with an idempotency key so
   * retries don't double-count.
   */
  | { name: 'checkout_completed'; method: 'crypto' | 'fiat' }
  /**
   * Checkout failed or was abandoned. `reason` is a short tag, not a
   * free-text message — free text is a cardinality trap in rollups.
   */
  | { name: 'checkout_failed'; method: 'crypto' | 'fiat'; reason: string }
  /**
   * A new profile row was created. `method` distinguishes the entry
   * path so we can compare which onboarding flow converts best.
   * Wired as a follow-up after M4i merges (profiles table enrichments).
   */
  | { name: 'profile_created'; method: 'handle' | 'email' | 'wallet' | 'farcaster' }
  /**
   * An existing session picked up an identity (wallet connected, email
   * verified, farcaster bound). Distinct from profile_created — one
   * user can be identified multiple times without creating new rows.
   */
  | { name: 'profile_identified'; method: 'email_verified' | 'wallet_connected' | 'farcaster_bound' };

/**
 * Lift the metadata fields off a FunnelEvent so the insert path can
 * stash them as jsonb. We strip `name` (which is the column) and keep
 * everything else.
 */
export function eventMetadata(event: FunnelEvent): Record<string, unknown> {
  const { name: _name, ...rest } = event;
  return rest as Record<string, unknown>;
}
