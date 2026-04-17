import { NextResponse } from 'next/server';
import { getStripe, STRIPE_WEBHOOK_SECRET } from '@/lib/stripe';
import { getPremiumRowByWallet, recordFiatUnlock } from '@/lib/db/queries';
import { setSessionPremium } from '@/lib/session-premium';
import { recordFunnelEvent } from '@/lib/funnel/record';
import { isValidSessionId } from '@/lib/session';
import { isValidAddress } from '@/lib/address';
import { openEscrowForFiatSession, externalIdForStripe } from '@/lib/contracts/escrowSigner';
import { quoteWordForUsd } from '@/lib/contracts/quoteWord';
import { kv } from '@/lib/kv';
import type Stripe from 'stripe';
import type { Address, Hex } from 'viem';

/**
 * POST /api/stripe/webhook
 *
 * Handles Stripe events. On `checkout.session.completed`:
 *
 *   1. If metadata includes a wallet, compute the $WORD amount via the
 *      oracle, open an on-chain escrow by calling `unlockForUser` from
 *      the escrow manager EOA, and write the `premium_users` row with
 *      the open-tx hash + external id + escrow_status='pending'. The
 *      sync-escrow-burns cron later flips the row to 'burned' or
 *      'refunded' once the contract event lands.
 *
 *   2. If the on-chain call fails for any reason, the DB row is still
 *      written (escrow telemetry null) and a retry entry is enqueued
 *      to `griddle:escrow-retries`. We still return 200 to Stripe —
 *      idempotency is guaranteed by the contract's `EscrowAlreadyExists`
 *      check, so the retry cron can replay safely.
 *
 *   3. If metadata has no wallet (anonymous fiat buyer), set
 *      `griddle:session-premium:{sessionId}` in Upstash so the buyer's
 *      current browser tab sees premium immediately. No contract call —
 *      the user migrates to a wallet later via /api/premium/migrate.
 *
 * The session id in metadata was set by the checkout route server-side
 * from the `x-session-id` header — it matches the buyer's current
 * browser session, so the KV write is immediately visible to their
 * next page load.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Fiat unlock is priced at $6 — the extra $1 over crypto covers Stripe
// fees + small treasury margin. Escrow needs $WORD equivalent at
// current oracle price (+1% buffer for drift inside the 30-day window).
const FIAT_USD_AMOUNT = 6;

// Stripe retry queue key. When the on-chain call can't complete, the
// session id lands here and the sync cron retries the escrow open
// before flipping its status.
const ESCROW_RETRY_KEY = 'griddle:escrow-retries';

export async function POST(req: Request): Promise<NextResponse> {
  if (!STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json(
      { error: 'STRIPE_WEBHOOK_SECRET not configured' },
      { status: 503 },
    );
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'missing stripe-signature header' }, { status: 400 });
  }

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.warn('[stripe/webhook] signature verification failed', err);
    return NextResponse.json({ error: 'signature verification failed' }, { status: 400 });
  }

  if (event.type !== 'checkout.session.completed') {
    return NextResponse.json({ received: true, ignored: event.type });
  }

  const session = event.data.object as Stripe.Checkout.Session;

  if (session.payment_status !== 'paid') {
    return NextResponse.json({ received: true, ignored: 'unpaid' });
  }

  const metadata = session.metadata ?? {};
  const sessionId = isValidSessionId(metadata.sessionId) ? metadata.sessionId : null;
  const wallet =
    typeof metadata.wallet === 'string' && isValidAddress(metadata.wallet)
      ? (metadata.wallet.toLowerCase() as Address)
      : null;

  if (!sessionId) {
    console.error('[stripe/webhook] missing or malformed sessionId in metadata', {
      stripeSessionId: session.id,
    });
    return NextResponse.json({ error: 'missing sessionId in metadata' }, { status: 500 });
  }

  try {
    if (wallet) {
      // Short-circuit duplicate payments BEFORE any on-chain work.
      // If the wallet already has a premium_users row (prior crypto
      // unlock, admin grant, or earlier fiat), `recordFiatUnlock`'s
      // `onConflictDoNothing` would drop the new DB insert — but if we
      // had already opened the on-chain escrow, that $WORD would be
      // pulled from the stockpile and locked with no DB trace, and
      // the sync cron would have no row to advance when `EscrowBurned`
      // fires. Log loudly, skip both on-chain + DB writes, and let
      // ops manually refund the Stripe charge out-of-band.
      //
      // Skip ONLY when the existing row belongs to a different path.
      // A row with a matching externalId means this is a Stripe
      // webhook retry for the same session — let it fall through;
      // the contract's EscrowAlreadyExists check handles idempotency
      // on the on-chain side.
      const thisSessionExternalId = externalIdForStripe(session.id);
      const existing = await getPremiumRowByWallet(wallet);
      if (existing && existing.externalId !== thisSessionExternalId) {
        console.warn(
          '[stripe/webhook] wallet premium via different path — skipping on-chain escrow + DB write',
          {
            wallet,
            existingSource: existing.source,
            existingExternalId: existing.externalId,
            thisSessionExternalId,
            existingUnlockedAt: existing.unlockedAt,
            stripeSessionId: session.id,
          },
        );
        // Funnel event still fires below (we did receive payment) but
        // with a distinguishing reason so ops can query the double-pay
        // rate and refund these out-of-band.
        try {
          await recordFunnelEvent(
            { name: 'checkout_completed', method: 'fiat' },
            { sessionId, wallet, idempotencyKey: event.id },
          );
        } catch (err) {
          console.warn('[stripe/webhook] funnel telemetry emit failed', err);
        }
        return NextResponse.json({
          received: true,
          sessionId: session.id,
          note: 'wallet already premium — no escrow opened, manual refund required',
        });
      }

      // Attempt to open the on-chain escrow. Any failure gets logged
      // + enqueued, but the DB row still lands so the user sees
      // premium on their next page load and the admin Transactions
      // tab shows the pending state.
      let escrowOpenTx: Hex | null = null;
      let wordAmount: bigint | null = null;
      let escrowStatus: 'pending' | null = null;
      try {
        wordAmount = await quoteWordForUsd(FIAT_USD_AMOUNT);
        const result = await openEscrowForFiatSession({
          user: wallet,
          wordAmount,
          stripeSessionId: session.id,
        });
        escrowOpenTx = result.txHash;
        escrowStatus = 'pending';
      } catch (err) {
        console.error('[stripe/webhook] on-chain escrow open failed — enqueuing retry', err);
        await kv
          .lpush(
            ESCROW_RETRY_KEY,
            JSON.stringify({
              stripeSessionId: session.id,
              wallet,
              externalId: externalIdForStripe(session.id),
              enqueuedAt: Date.now(),
              reason: err instanceof Error ? err.message : 'unknown',
            }),
          )
          .catch((qerr) => {
            console.error('[stripe/webhook] retry enqueue itself failed', qerr);
          });
      }

      await recordFiatUnlock({
        stripeSessionId: session.id,
        wallet,
        escrowOpenTx,
        externalId: externalIdForStripe(session.id),
        wordAmount,
        escrowStatus,
      });
    } else {
      // No wallet: bind premium to the browser session. The session key is
      // the only record until the user connects a wallet and migration runs.
      // Escrow is deferred until the user connects + migrates; the retry
      // cron handles back-filling when a wallet appears.
      await setSessionPremium(sessionId, session.id);
    }
  } catch (err) {
    console.error('[stripe/webhook] failed to record unlock', err);
    return NextResponse.json({ error: 'failed to record unlock' }, { status: 500 });
  }

  try {
    await recordFunnelEvent(
      { name: 'checkout_completed', method: 'fiat' },
      { sessionId, wallet, idempotencyKey: event.id },
    );
  } catch (err) {
    console.warn('[stripe/webhook] funnel telemetry emit failed', err);
  }

  return NextResponse.json({ received: true, sessionId: session.id });
}
