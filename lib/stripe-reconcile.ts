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

/** Sessions younger than this are skipped. The webhook fires within
 *  seconds, but a retry storm or a slow on-chain open can leave a
 *  legitimate purchase briefly unrecorded, and racing it would only
 *  produce noise — the outcome is identical either way, since both
 *  paths are idempotent. */
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
  /** Could not write the row. The buyer still has nothing. */
  | 'heal_failed'
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
    await kv
      .lpush(
        ESCROW_RETRY_KEY,
        JSON.stringify({
          stripeSessionId: session.id,
          wallet,
          externalId,
          enqueuedAt: Date.now(),
          reason: `reconcile: ${escrowDetail ?? 'escrow open failed'}`,
        }),
      )
      .catch((err) => {
        console.error('[reconcile] retry enqueue failed', err);
      });
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
  const settled = sessions.filter((s) => s.created <= graceCutoff);

  const keys = settled.map((s) => ({
    sessionId: s.id,
    externalId: externalIdForStripe(s.id) as string,
  }));
  const recorded = await findRecordedStripeSessions(keys);
  const missing = settled.filter((s) => !recorded.has(s.id));

  const gaps: ReconcileGap[] = [];
  let gapsHealed = 0;
  let healsSpent = 0;

  for (const session of missing) {
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

    if (!wallet) {
      gaps.push({ ...base, outcome: 'no_wallet_anchor' });
      continue;
    }

    if (healsSpent >= maxHeals) {
      gaps.push({
        ...base,
        outcome: 'heal_failed',
        detail: 'heal budget for this run exhausted; retried next run',
      });
      continue;
    }

    healsSpent += 1;
    try {
      const result = await healWalletSession(session, wallet, email);
      gaps.push({ ...base, ...result });
      if (result.outcome === 'healed' || result.outcome === 'healed_escrow_deferred') {
        gapsHealed += 1;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[reconcile] heal threw', { stripeSessionId: session.id, message });
      gaps.push({ ...base, outcome: 'heal_failed', detail: message });
    }
  }

  return {
    sessionsChecked: settled.length,
    gapsFound: gaps.length,
    gapsHealed,
    gaps,
    truncated: pagesTruncated || healsSpent >= maxHeals,
  };
}

/** Plain-text alert body. One line per gap, newest first. */
export function formatReconcileAlert(summary: ReconcileSummary): string {
  const lines = [
    `${summary.gapsFound} paid Stripe session(s) had no record in the database.`,
    `${summary.gapsHealed} healed automatically. Checked ${summary.sessionsChecked} paid session(s) from the last ${RECONCILE_LOOKBACK_DAYS} days.`,
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
    lines.push('', 'Run was truncated — more sessions or gaps remain for the next run.');
  }
  return lines.join('\n');
}
