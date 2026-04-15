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

// Bounded slug shape for the `checkout_failed` reason bucket. Snake-
// case alphanum, max 32 chars. Caps the cardinality of the breakdown
// histogram and keeps an attacker from injecting arbitrary strings
// into the funnel tab's UI.
const REASON_PATTERN = /^[a-z0-9_]{1,32}$/;

type Sanitizer = (body: Record<string, unknown>) => FunnelEvent | null;

// Per-event sanitizer whitelist. Each entry inspects the raw body,
// pulls out only the fields the event shape defines, and returns a
// fresh FunnelEvent object — never passes the request body through
// unfiltered. Extra / unknown fields in the body are ignored. An
// event whose required fields are missing or out-of-enum is rejected
// (returns null → caller swallows into 204).
//
// Critical: we must not let unauthenticated callers inject arbitrary
// keys into the metadata jsonb column. Bloat and breakdown pollution
// both cost money and break the admin dashboard.
const SANITIZERS: Record<string, Sanitizer> = {
  stats_opened(body) {
    const variant = body.variant;
    if (variant !== 'anon' && variant !== 'account' && variant !== 'premium') return null;
    return { name: 'stats_opened', variant };
  },
  premium_gate_shown(body) {
    const feature = body.feature;
    if (feature !== 'leaderboard' && feature !== 'archive' && feature !== 'premium') return null;
    return { name: 'premium_gate_shown', feature };
  },
  upgrade_clicked(body) {
    const method = body.method;
    if (method !== 'crypto' && method !== 'fiat') return null;
    return { name: 'upgrade_clicked', method };
  },
  checkout_started(body) {
    const method = body.method;
    if (method !== 'crypto' && method !== 'fiat') return null;
    return { name: 'checkout_started', method };
  },
  checkout_failed(body) {
    const method = body.method;
    const reason = body.reason;
    if (method !== 'crypto' && method !== 'fiat') return null;
    if (typeof reason !== 'string' || !REASON_PATTERN.test(reason)) return null;
    return { name: 'checkout_failed', method, reason };
  },
  profile_identified(body) {
    const method = body.method;
    if (
      method !== 'email_verified' &&
      method !== 'wallet_connected' &&
      method !== 'farcaster_bound'
    ) {
      return null;
    }
    return { name: 'profile_identified', method };
  },
};

// Cap the raw request body so an attacker can't spray gigabytes into
// the ingest path. Any well-formed FunnelEvent is well under 1 KB.
const MAX_BODY_BYTES = 1024;

export async function POST(req: Request): Promise<Response> {
  // Every step of this handler must be exception-safe: the docstring
  // promises "always 204" and telemetry must never break a user-facing
  // flow. getSessionId throws if middleware didn't run, so it gets the
  // same try/catch as everything else.
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
      return new Response(null, { status: 204 });
    }

    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return new Response(null, { status: 204 });
    }
    if (!parsed || typeof parsed !== 'object' || typeof parsed.name !== 'string') {
      return new Response(null, { status: 204 });
    }

    const sanitize = SANITIZERS[parsed.name];
    if (!sanitize) {
      // Unknown event name — also covers server-only events like
      // checkout_completed and profile_created which are deliberately
      // not in the SANITIZERS map.
      return new Response(null, { status: 204 });
    }
    const event = sanitize(parsed);
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
