import { db } from '@/lib/db/client';
import { funnelEvents } from '@/lib/db/schema';
import { eventMetadata, type FunnelEvent } from './events';

/**
 * Server-side funnel event emitter. Used directly by:
 *   - /api/telemetry/event (forwards client-side events)
 *   - Stripe webhook (checkout_completed — critical for accuracy)
 *   - Crypto unlock tx confirmation path (same)
 *   - /api/stripe/checkout (checkout_started)
 *
 * Identity is passed in by the caller; this function does not reach
 * into KV. That keeps the server-side paths (webhook, tx confirmation)
 * from doing unrelated KV lookups for events the caller already knows
 * the wallet/profile for.
 *
 * `idempotencyKey` is critical for webhook-driven emitters because
 * Stripe retries the same event id multiple times on transient errors.
 * The partial unique index on `idempotency_key` turns duplicates into
 * onConflictDoNothing no-ops without raising.
 *
 * All failures are logged and swallowed — funnel telemetry must never
 * break a user-facing flow. A dropped event is a visible dent in the
 * dashboard; an exception from a webhook handler is a Stripe retry
 * storm.
 */
export async function recordFunnelEvent(
  event: FunnelEvent,
  identity: {
    sessionId: string;
    wallet?: string | null;
    profileId?: number | null;
    idempotencyKey?: string | null;
  },
): Promise<void> {
  try {
    await db.insert(funnelEvents).values({
      eventName: event.name,
      sessionId: identity.sessionId,
      wallet: identity.wallet ?? null,
      profileId: identity.profileId ?? null,
      metadata: eventMetadata(event),
      idempotencyKey: identity.idempotencyKey ?? null,
    }).onConflictDoNothing();
  } catch (err) {
    console.warn('[funnel] recordFunnelEvent failed', { event: event.name, err });
  }
}
