import { getStripe } from '@/lib/stripe';
import { isValidAddress } from '@/lib/address';
import { isValidEmail, normalizeEmail } from '@/lib/email';
import {
  externalIdForStripe,
  openEscrowForFiatSession,
  ESCROW_RETRY_KEY,
  FIAT_ESCROW_USD,
} from '@/lib/contracts/escrowSigner';
import { quoteWordForUsd } from '@/lib/contracts/quoteWord';
import {
  findRecordedStripeSessions,
  getPremiumRowByWallet,
  recordFiatUnlock,
} from '@/lib/db/queries';
import { kv } from '@/lib/kv';
import type Stripe from 'stripe';
import type { Address, Hex } from 'viem';

/**
 * Stripe → DB reconciliation.
 *
 * The webhook is the only thing that turns a payment into premium. If
 * it never fires — no endpoint registered, wrong URL, a redirecting
 * host, a deploy with a stale signing secret — the money arrives and
 * the buyer gets nothing, silently. Nothing in the system notices,
 * because every existing recovery path (the `griddle:escrow-retries`
 * queue, the settle-event scan) starts from a row the webhook already
 * wrote. No webhook, no row, no recovery.
 *
 * This module closes that hole by working the other way round: it asks
 * Stripe what it has been paid for, then checks each of those payments
 * against the DB. A paid session with no record is a gap.
 *
 * Wallet-path gaps are healed here, with the same primitives the
 * webhook uses. Email-only gaps are reported but never healed — see
 * `reconcileStripeSessions` for why that asymmetry is deliberate.
 */

/** How far back to ask Stripe. A week comfortably covers an hourly
 *  cron that has been failing, plus a weekend of not looking. */
export const RECONCILE_LOOKBACK_DAYS = 7;

/** Payments charged more recently than this are skipped. Measured from
 *  the charge, not from the checkout session, which is created when
 *  the buyer opens the page. The webhook fires within seconds, but a
 *  retry storm or a slow on-chain open can leave a legitimate purchase
 *  briefly unrecorded, and racing it risks two concurrent
 *  `unlockForUser` calls. */
export const RECONCILE_GRACE_MINUTES = 15;

/** Heals per run. Each one sends a transaction and waits for it, so
 *  this bounds our share of the cron's `maxDuration`. A backlog drains
 *  over consecutive hours. */
export const RECONCILE_MAX_HEALS_PER_RUN = 5;

/** Stripe pages to walk, at 100 sessions each. At Griddle's volume one
 *  page covers a week many times over; the bound exists so a runaway
 *  cannot stall the cron. */
const MAX_STRIPE_PAGES = 5;

export type GapOutcome =
  /** Row written, buyer has premium. */
  | 'healed'
  /** Row written, but the on-chain escrow did not open; queued for the
   *  existing retry drain. The buyer HAS premium. */
  | 'healed_escrow_deferred'
  /** Row written and the buyer HAS premium, but the escrow neither
   *  opened nor reached the retry queue. Nothing will pick this up on
   *  its own: the row makes the session look recorded to the next run,
   *  and the drain never saw the job. Needs a person. */
  | 'healed_escrow_unqueued'
  /** Could not write the row. The buyer still has nothing. */
  | 'heal_failed'
  /** Not attempted this run — the per-run heal budget was spent, or the
   *  payment state could not be read from Stripe. The next run retries
   *  it automatically. No action needed. */
  | 'heal_deferred'
  /** The wallet already holds premium from a different purchase or
   *  grant. Healing would pull stockpile $WORD for nothing; a human
   *  should refund the duplicate charge. */
  | 'needs_manual_refund'
  /** Anonymous buyer, no wallet to attach premium to. Not healable
   *  from here — see the note in `reconcileStripeSessions`. */
  | 'no_wallet_anchor';

export interface ReconcileGap {
  stripeSessionId: string;
  createdAt: string;
  wallet: string | null;
  email: string | null;
  amountTotal: number | null;
  outcome: GapOutcome;
  detail?: string;
  escrowOpenTx?: string | null;
}

export interface ReconcileSummary {
  sessionsChecked: number;
  gapsFound: number;
  gapsHealed: number;
  /** Unrecorded sessions whose payment was charged too recently to
   *  judge — the webhook may still be in flight. Not gaps. */
  skippedInFlight: number;
  /** Unrecorded sessions whose payment was refunded or disputed. There
   *  is nothing to deliver, so these are not gaps. */
  skippedRefunded: number;
  gaps: ReconcileGap[];
  /** True when the lookback held more sessions than we walked, or more
   *  gaps than we were willing to heal in one run. */
  truncated: boolean;
}

/**
 * Every paid checkout session created since `sinceUnix`, walked over at
 * most `MAX_STRIPE_PAGES` pages.
 */
async function listPaidSessions(
  sinceUnix: number,
): Promise<{ sessions: Stripe.Checkout.Session[]; truncated: boolean }> {
  const stripe = getStripe();
  const sessions: Stripe.Checkout.Session[] = [];
  let startingAfter: string | undefined;
  let truncated = false;

  for (let page = 0; page < MAX_STRIPE_PAGES; page++) {
    const batch: Stripe.ApiList<Stripe.Checkout.Session> =
      await stripe.checkout.sessions.list({
        created: { gte: sinceUnix },
        // Without this filter the window fills with abandoned and
        // expired sessions — which vastly outnumber completed ones —
        // and Stripe returns newest first, so real paid sessions fall
        // off the end of the page budget unseen. That would silently
        // defeat the whole job.
        status: 'complete',
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });

    for (const session of batch.data) {
      if (session.payment_status === 'paid') sessions.push(session);
    }

    if (!batch.has_more || batch.data.length === 0) break;
    startingAfter = batch.data[batch.data.length - 1].id;
    if (page === MAX_STRIPE_PAGES - 1) truncated = true;
  }

  return { sessions, truncated };
}

interface PaymentFacts {
  /** When the card was actually charged. A checkout session's own
   *  `created` is when the buyer OPENED the page, which can be long
   *  before they pay. */
  paidAt: number | null;
  refunded: boolean;
  disputed: boolean;
  /** True when Stripe could not be read. The caller must not treat
   *  unknown as clean. */
  unknown: boolean;
}

/**
 * Read the payment behind a session: when it was charged, and whether
 * the money is still ours.
 *
 * A Checkout Session stays `payment_status: 'paid'` forever, including
 * after a full refund or a lost dispute, so the session alone cannot
 * answer either question. Only fetched for sessions that already look
 * like gaps, which are rare — this costs one API call per gap, not per
 * session.
 */
async function loadPaymentFacts(session: Stripe.Checkout.Session): Promise<PaymentFacts> {
  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : (session.payment_intent?.id ?? null);

  if (!paymentIntentId) {
    return { paidAt: null, refunded: false, disputed: false, unknown: false };
  }

  try {
    const intent = await getStripe().paymentIntents.retrieve(paymentIntentId, {
      expand: ['latest_charge'],
    });
    const charge =
      typeof intent.latest_charge === 'string' ? null : (intent.latest_charge ?? null);
    if (!charge) {
      return { paidAt: null, refunded: false, disputed: false, unknown: false };
    }
    return {
      paidAt: charge.created,
      refunded: charge.refunded || charge.amount_refunded > 0,
      disputed: charge.disputed,
      unknown: false,
    };
  } catch (err) {
    console.error('[reconcile] could not read payment state', {
      stripeSessionId: session.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return { paidAt: null, refunded: false, disputed: false, unknown: true };
  }
}

/**
 * Re-run the webhook's fulfillment for one wallet-path session.
 *
 * Deliberately built from the same primitives the webhook calls rather
 * than by refactoring the webhook itself: that route is the live
 * payment path, and the ordering inside it (duplicate-payment guard
 * BEFORE any on-chain work) is load-bearing. The guard is repeated
 * here for the same reason it exists there — an escrow opened against
 * a wallet that is already premium spends stockpile $WORD that no row
 * will ever account for.
 */
async function healWalletSession(
  session: Stripe.Checkout.Session,
  wallet: Address,
  email: string | null,
): Promise<{ outcome: GapOutcome; detail?: string; escrowOpenTx?: Hex | null }> {
  const externalId = externalIdForStripe(session.id);

  const existing = await getPremiumRowByWallet(wallet);
  if (existing && existing.externalId !== externalId) {
    return {
      outcome: 'needs_manual_refund',
      detail: `wallet already premium via ${existing.source} (externalId ${existing.externalId ?? 'null'})`,
    };
  }

  let escrowOpenTx: Hex | null = null;
  let wordAmount: bigint | null = null;
  let escrowStatus: 'pending' | null = null;
  let escrowDetail: string | undefined;

  try {
    wordAmount = await quoteWordForUsd(FIAT_ESCROW_USD);
    const result = await openEscrowForFiatSession({
      user: wallet,
      wordAmount,
      stripeSessionId: session.id,
    });
    escrowOpenTx = result.txHash;
    escrowStatus = 'pending';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/EscrowAlreadyExists/i.test(message)) {
      // A previous attempt landed the unlockForUser tx and then failed
      // before its DB write. The chain is already correct.
      escrowStatus = 'pending';
    } else {
      escrowDetail = message;
    }
  }

  // The row is what grants premium, so it is written whether or not the
  // escrow opened — exactly as the webhook does. A buyer waiting on
  // their purchase must not wait on the chain as well.
  try {
    await recordFiatUnlock({
      stripeSessionId: session.id,
      wallet,
      escrowOpenTx,
      externalId,
      wordAmount,
      escrowStatus,
      email,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { outcome: 'heal_failed', detail: message };
  }

  if (escrowStatus === null) {
    // Row exists now, so the existing retry drain (which UPDATEs by
    // wallet) can finish the on-chain half on its next pass.
    //
    // This enqueue is the ONLY thing that will ever reopen the escrow.
    // The row we just wrote makes the session look recorded, so the
    // next reconcile run skips it, and the drain only ever sees jobs
    // that reached the queue. A swallowed failure here would strand
    // the escrow forever behind a reassuring 'deferred' label, so the
    // failure is surfaced as its own outcome instead.
    try {
      await kv.lpush(
        ESCROW_RETRY_KEY,
        JSON.stringify({
          stripeSessionId: session.id,
          wallet,
          externalId,
          enqueuedAt: Date.now(),
          reason: `reconcile: ${escrowDetail ?? 'escrow open failed'}`,
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[reconcile] retry enqueue failed — escrow stranded', {
        stripeSessionId: session.id,
        wallet,
        message,
      });
      return {
        outcome: 'healed_escrow_unqueued',
        detail: `escrow open failed (${escrowDetail ?? 'unknown'}) and retry enqueue failed (${message})`,
        escrowOpenTx: null,
      };
    }
    return { outcome: 'healed_escrow_deferred', detail: escrowDetail, escrowOpenTx: null };
  }

  return { outcome: 'healed', escrowOpenTx };
}

/**
 * Compare paid Stripe sessions against the DB and repair what can be
 * repaired.
 *
 * **Why email-only gaps are reported, never healed.** An anonymous
 * buyer's premium lives in a session KV key tied to the browser tab
 * that paid; that tab is long gone by the time this runs. The durable
 * anchor would be a `profiles` row keyed on the email Stripe collected
 * — but that email is unverified, and writing it onto an existing
 * profile is a known account-takeover vector (`recordFiatUnlock`
 * refuses to do it for exactly this reason). Creating the row from a
 * cron would reintroduce the hole with no human in the loop. So these
 * surface in the alert and a person decides.
 */
export async function reconcileStripeSessions(options?: {
  lookbackDays?: number;
  maxHeals?: number;
}): Promise<ReconcileSummary> {
  const lookbackDays = options?.lookbackDays ?? RECONCILE_LOOKBACK_DAYS;
  const maxHeals = options?.maxHeals ?? RECONCILE_MAX_HEALS_PER_RUN;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const sinceUnix = nowSeconds - lookbackDays * 24 * 60 * 60;
  const graceCutoff = nowSeconds - RECONCILE_GRACE_MINUTES * 60;

  const { sessions, truncated: pagesTruncated } = await listPaidSessions(sinceUnix);

  const keys = sessions.map((s) => ({
    sessionId: s.id,
    externalId: externalIdForStripe(s.id) as string,
  }));
  const recorded = await findRecordedStripeSessions(keys);
  const candidates = sessions.filter((s) => !recorded.has(s.id));

  const gaps: ReconcileGap[] = [];
  let gapsHealed = 0;
  let healsSpent = 0;
  let skippedInFlight = 0;
  let skippedRefunded = 0;

  for (const session of candidates) {
    const rawWallet = session.metadata?.wallet;
    const wallet =
      typeof rawWallet === 'string' && isValidAddress(rawWallet)
        ? (rawWallet.toLowerCase() as Address)
        : null;
    const rawEmail = session.customer_details?.email ?? session.customer_email ?? null;
    const email = isValidEmail(rawEmail) ? normalizeEmail(rawEmail) : null;

    const base = {
      stripeSessionId: session.id,
      createdAt: new Date(session.created * 1000).toISOString(),
      wallet,
      email,
      amountTotal: session.amount_total,
    };

    // What the payment itself says. Checked per candidate rather than
    // per session: gaps are rare, so this is a handful of API calls.
    const facts = await loadPaymentFacts(session);

    if (facts.unknown) {
      // Stripe was unreachable for this one. Do NOT heal on an unknown
      // refund state, and do not call it a gap either — the session
      // stays unrecorded, so the next run judges it again.
      gaps.push({
        ...base,
        outcome: 'heal_deferred',
        detail: 'could not read payment state from Stripe; retried next run',
      });
      continue;
    }

    // The grace window belongs on the moment of payment, not on the
    // moment the checkout page opened. A buyer can sit on an open
    // session for an hour and pay ten seconds before this cron runs;
    // judged by `created` that purchase looks long settled, and we
    // would race a webhook that is still in flight — two concurrent
    // `unlockForUser` calls, one of which reverts after broadcast and
    // leaves a dead tx hash on the row.
    const paidAt = facts.paidAt ?? session.created;
    if (paidAt > graceCutoff) {
      skippedInFlight += 1;
      continue;
    }

    // Money already returned. There is nothing to deliver, and healing
    // would grant premium for a charge that ops reversed. A Checkout
    // Session keeps reporting `payment_status: 'paid'` after a full
    // refund, so only the charge can answer this.
    if (facts.refunded || facts.disputed) {
      skippedRefunded += 1;
      continue;
    }

    if (!wallet) {
      gaps.push({ ...base, outcome: 'no_wallet_anchor' });
      continue;
    }

    if (healsSpent >= maxHeals) {
      gaps.push({
        ...base,
        outcome: 'heal_deferred',
        detail: 'heal budget for this run exhausted; retried next run',
      });
      continue;
    }

    healsSpent += 1;
    try {
      const result = await healWalletSession(session, wallet, email);
      gaps.push({ ...base, ...result });
      if (
        result.outcome === 'healed' ||
        result.outcome === 'healed_escrow_deferred' ||
        result.outcome === 'healed_escrow_unqueued'
      ) {
        gapsHealed += 1;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[reconcile] heal threw', { stripeSessionId: session.id, message });
      gaps.push({ ...base, outcome: 'heal_failed', detail: message });
    }
  }

  return {
    sessionsChecked: sessions.length,
    gapsFound: gaps.length,
    gapsHealed,
    skippedInFlight,
    skippedRefunded,
    gaps,
    truncated: pagesTruncated || healsSpent >= maxHeals,
  };
}

/** Plain-text alert body. One line per gap, newest first. */
export function formatReconcileAlert(summary: ReconcileSummary): string {
  const lines = [
    `${summary.gapsFound} paid Stripe session(s) had no record in the database.`,
    `${summary.gapsHealed} healed automatically. Checked ${summary.sessionsChecked} completed session(s) from the last ${RECONCILE_LOOKBACK_DAYS} days.`,
    `Skipped: ${summary.skippedInFlight} charged too recently to judge, ${summary.skippedRefunded} refunded or disputed.`,
    '',
  ];
  for (const gap of summary.gaps) {
    lines.push(
      [
        gap.createdAt,
        gap.stripeSessionId,
        gap.amountTotal != null ? `$${(gap.amountTotal / 100).toFixed(2)}` : 'amount unknown',
        gap.wallet ?? 'no wallet',
        gap.email ?? 'no email',
        gap.outcome.toUpperCase(),
        gap.detail ?? '',
      ]
        .filter(Boolean)
        .join('  ·  '),
    );
  }
  if (summary.truncated) {
    lines.push(
      '',
      'RUN WAS TRUNCATED — the page or heal budget ran out, so sessions',
      'beyond it were never examined. A gap may be hiding past the end of',
      'this list. Raise the budget or widen the scan if this repeats.',
    );
  }
  return lines.join('\n');
}
