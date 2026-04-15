import { NextResponse } from 'next/server';
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

// Event names the server accepts. Hard-coded instead of derived from
// the TypeScript union because we don't ship the type catalog at
// runtime and we want a cheap allow-list check to discard garbage
// from malformed clients / bots before writing to the DB.
const KNOWN_EVENTS = new Set<string>([
  'stats_opened',
  'premium_gate_shown',
  'upgrade_clicked',
  'checkout_started',
  'checkout_completed',
  'checkout_failed',
  'profile_created',
  'profile_identified',
]);

export async function POST(req: Request): Promise<Response> {
  let event: FunnelEvent | null = null;
  try {
    const body = (await req.json()) as FunnelEvent;
    if (body && typeof body === 'object' && typeof body.name === 'string' && KNOWN_EVENTS.has(body.name)) {
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

  return new Response(null, { status: 204 });
}
