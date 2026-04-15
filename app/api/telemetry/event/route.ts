import { getSessionId } from '@/lib/session';
import { getSessionWallet } from '@/lib/wallet-session';
import { recordFunnelEvent } from '@/lib/funnel/record';
import type { FunnelEvent } from '@/lib/funnel/events';

/**
 * POST /api/telemetry/event
 *
 * Client-side funnel event ingestion. Body is a `FunnelEvent` object
 * from `lib/funnel/events.ts`. Identity is resolved server-side from
 * the session cookie + wallet-session KV binding, so the client never
 * sees its own wallet/profile — just fires the event.
 *
 * Always returns 204 (even on validation failure). Funnel telemetry
 * must never break a user-facing flow, and returning 4xx would let a
 * stray bad call surface as a console error or a retry storm.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Events the CLIENT endpoint accepts. Intentionally narrower than
// the full FunnelEvent union: `checkout_completed` and `profile_created`
// are authoritative conversion signals emitted only from server paths
// (Stripe webhook, crypto tx verify, future profile endpoints) with
// idempotency keys. Accepting them here would let any unauthenticated
// caller POST forged conversion events straight into the funnel —
// client events have no idempotency key, so dedupe can't save us.
const CLIENT_ALLOWED_EVENTS = new Set<string>([
  'stats_opened',
  'premium_gate_shown',
  'upgrade_clicked',
  'checkout_started',
  'checkout_failed',
  'profile_identified',
]);

export async function POST(req: Request): Promise<Response> {
  // Every step of this handler must be exception-safe: the docstring
  // promises "always 204" and telemetry must never break a user-facing
  // flow. getSessionId throws if middleware didn't run, so it gets the
  // same try/catch as everything else.
  try {
    let event: FunnelEvent | null = null;
    try {
      const body = (await req.json()) as FunnelEvent;
      if (
        body &&
        typeof body === 'object' &&
        typeof body.name === 'string' &&
        CLIENT_ALLOWED_EVENTS.has(body.name)
      ) {
        event = body;
      }
    } catch {
      // malformed JSON — fall through to no-op 204
    }

    if (!event) {
      return new Response(null, { status: 204 });
    }

    const sessionId = await getSessionId();
    const wallet = await getSessionWallet(sessionId);
    await recordFunnelEvent(event, { sessionId, wallet });
  } catch (err) {
    console.warn('[telemetry/event] ingest failed', err);
  }

  return new Response(null, { status: 204 });
}
