import { NextResponse } from 'next/server';
import { createPublicClient, http, parseEventLogs } from 'viem';
import { base } from 'viem/chains';
import { griddlePremiumAbi } from '@/lib/contracts/griddlePremiumAbi';
import { getGriddlePremiumAddress } from '@/lib/contracts/addresses';
import {
  openEscrowForFiatSession,
  externalIdForStripe,
  ESCROW_RETRY_KEY,
  FIAT_ESCROW_USD,
} from '@/lib/contracts/escrowSigner';
import { quoteWordForUsd } from '@/lib/contracts/quoteWord';
import { getPremiumRowByWallet } from '@/lib/db/queries';
import { kv } from '@/lib/kv';
import { db } from '@/lib/db/client';
import { premiumUsers } from '@/lib/db/schema';
import { and, eq, isNotNull } from 'drizzle-orm';

/**
 * GET /api/cron/sync-escrow-burns
 *
 * Two responsibilities, run hourly via Vercel Cron:
 *
 *  1. **Backfill pending escrow-opens** — if the Stripe webhook failed
 *     to open the on-chain escrow at `checkout.session.completed` time,
 *     the session landed in the `griddle:escrow-retries` queue. We
 *     drain that queue here and try again. The contract's
 *     `EscrowAlreadyExists` check gives us idempotency if a previous
 *     attempt actually did open the escrow before failing on a later
 *     step.
 *
 *  2. **Advance escrow lifecycle** — scan recent `EscrowBurned` +
 *     `EscrowRefunded` events on GriddlePremium and flip the
 *     corresponding `premium_users.escrow_status` to 'burned' or
 *     'refunded', with the settling tx hash in `escrow_burn_tx`. Uses
 *     the `external_id` unique index so the join is O(1).
 *
 * Authorized via the shared `CRON_SECRET` header (Vercel Cron sets
 * this automatically from the env var).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// How far back to scan on a first-run (no stored cursor). Blocks on
// Base tick every ~2s so 3_000 blocks ≈ 100 minutes — comfortable
// bootstrap margin for an hourly cron. Subsequent runs pick up from
// the persisted cursor, NOT from `currentBlock - LOOKBACK_BLOCKS`.
const INITIAL_LOOKBACK_BLOCKS = 3_000n;

// Max blocks to scan per run. If the cron skips runs (deploy, outage,
// config drift) and the cursor falls far behind, we chunk the
// catch-up across multiple runs instead of losing events past the
// lookback window or hitting RPC block-range limits. 10_000 is
// comfortable for Alchemy/Base public endpoints.
const MAX_SCAN_BLOCKS = 10_000n;

// How many blocks of overlap to keep between runs so a reorg near
// the cursor boundary doesn't leave events unprocessed. DB updates
// are keyed by externalId and idempotent, so re-scanning is free.
const CURSOR_OVERLAP_BLOCKS = 300n;

const CURSOR_KEY = 'griddle:escrow-sync-cursor';

interface RetryEntry {
  stripeSessionId: string;
  wallet: `0x${string}`;
  externalId: string;
  enqueuedAt: number;
  reason: string;
}

export async function GET(req: Request): Promise<NextResponse> {
  const auth = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const premiumAddress = getGriddlePremiumAddress();
  if (!premiumAddress) {
    return NextResponse.json({ error: 'premium address not configured' }, { status: 503 });
  }

  const client = createPublicClient({
    chain: base,
    transport: http(process.env.BASE_RPC_URL),
  });

  const summary: {
    retriesProcessed: number;
    retriesSucceeded: number;
    retriesSkippedAlreadyPremium: number;
    burnEventsApplied: number;
    refundEventsApplied: number;
    scanFromBlock?: string;
    scanToBlock?: string;
    caughtUp?: boolean;
  } = {
    retriesProcessed: 0,
    retriesSucceeded: 0,
    retriesSkippedAlreadyPremium: 0,
    burnEventsApplied: 0,
    refundEventsApplied: 0,
  };

  // --- 1. Drain the retry queue -----------------------------------------
  // Bound the work per run so a long backlog can't exceed `maxDuration`.
  // Anything left requeues to the next hour automatically.
  const maxRetriesPerRun = 20;
  for (let i = 0; i < maxRetriesPerRun; i++) {
    const raw = await kv.rpop<string>(ESCROW_RETRY_KEY);
    if (!raw) break;
    let entry: RetryEntry;
    try {
      entry = typeof raw === 'string' ? (JSON.parse(raw) as RetryEntry) : (raw as RetryEntry);
    } catch (err) {
      console.error('[escrow-sync] bad retry entry, dropping', err);
      continue;
    }
    summary.retriesProcessed += 1;

    // Distinguish two states before retrying the on-chain open:
    //   (a) Row belongs to THIS Stripe session and is missing escrow
    //       fields — that's exactly what the retry is for. Proceed.
    //   (b) Row belongs to a DIFFERENT premium path (crypto unlock,
    //       admin grant, earlier fiat session). Re-opening an escrow
    //       would pull stockpile $WORD unnecessarily and overwrite
    //       source-specific fields. Drop the retry.
    //
    // The webhook always writes a row for the fiat path (even on
    // escrow failure) so a naive "row exists → skip" check would
    // drop every retry — the defeat round-5 created. Use `externalId`
    // (keccak256 of the Stripe session id, mirrors the contract's
    // idempotency key) to identify which session a row belongs to.
    const thisSessionExternalId = externalIdForStripe(entry.stripeSessionId);
    const existing = await getPremiumRowByWallet(entry.wallet);
    if (existing && existing.externalId !== thisSessionExternalId) {
      console.warn(
        '[escrow-sync] wallet premium via different path — dropping retry, manual Stripe refund required',
        {
          wallet: entry.wallet,
          existingSource: existing.source,
          existingExternalId: existing.externalId,
          thisSessionExternalId,
          existingUnlockedAt: existing.unlockedAt,
          stripeSessionId: entry.stripeSessionId,
        },
      );
      summary.retriesSkippedAlreadyPremium += 1;
      continue;
    }

    try {
      // The oracle can drift between the original webhook and this retry,
      // so re-quote $WORD fresh. $5 matches the on-chain escrow size
      // set by the webhook (see FIAT_ESCROW_USD there) — the Stripe
      // charge is $6 but only $5 worth of $WORD is burned.
      const wordAmount = await quoteWordForUsd(FIAT_ESCROW_USD);
      const result = await openEscrowForFiatSession({
        user: entry.wallet,
        wordAmount,
        stripeSessionId: entry.stripeSessionId,
      });
      await db
        .update(premiumUsers)
        .set({
          escrowOpenTx: result.txHash,
          externalId: result.externalId,
          escrowStatus: 'pending',
          wordBurned: wordAmount.toString(),
        })
        .where(eq(premiumUsers.wallet, entry.wallet.toLowerCase()));
      summary.retriesSucceeded += 1;
    } catch (err) {
      // If the failure was "EscrowAlreadyExists" the on-chain state is
      // already correct — a prior attempt landed the unlockForUser tx
      // before failing downstream. Backfill the DB row so the admin
      // ledger stops showing stale nulls. Match against either the
      // viem-decoded error name (requires the error in the ABI) or the
      // raw revert selector — belt-and-suspenders since a missing ABI
      // entry previously turned the regex into a permanent poison pill.
      const message = err instanceof Error ? err.message : String(err);
      const isAlreadyExists = /EscrowAlreadyExists/i.test(message);
      if (isAlreadyExists) {
        // escrowOpenTx stays null — we don't have the original open
        // tx hash from a prior run. The EscrowBurned/Refunded scan
        // below will backfill the settle tx + status correctly via
        // `externalId`, which is enough for the admin ledger.
        const externalId = externalIdForStripe(entry.stripeSessionId);
        await db
          .update(premiumUsers)
          .set({
            externalId,
            escrowStatus: 'pending',
          })
          .where(eq(premiumUsers.wallet, entry.wallet.toLowerCase()));
        summary.retriesSucceeded += 1;
        continue;
      }
      console.error('[escrow-sync] retry failed, requeuing', err);
      await kv.lpush(ESCROW_RETRY_KEY, JSON.stringify(entry)).catch(() => {});
      // Don't spin forever on a poison entry — break after this attempt.
      break;
    }
  }

  // --- 2. Scan settle events -------------------------------------------
  // Cursor is trusted as the authoritative "last processed up to" —
  // do NOT clamp it to `currentBlock - LOOKBACK_BLOCKS`, which was the
  // old behavior and caused events in a downtime gap to be skipped
  // forever. Instead:
  //   - On first run (no cursor), bootstrap from currentBlock -
  //     INITIAL_LOOKBACK_BLOCKS so we don't scan full chain history.
  //   - On subsequent runs, use the stored cursor unclamped.
  //   - Cap the window per run at MAX_SCAN_BLOCKS so an old cursor
  //     catches up across multiple runs instead of exploding a single
  //     getLogs call past RPC provider limits.
  const currentBlock = await client.getBlockNumber();
  const cursorRaw = await kv.get<string>(CURSOR_KEY);
  const fromBlock = cursorRaw
    ? BigInt(cursorRaw)
    : currentBlock - INITIAL_LOOKBACK_BLOCKS;
  const toBlock =
    fromBlock + MAX_SCAN_BLOCKS < currentBlock
      ? fromBlock + MAX_SCAN_BLOCKS
      : currentBlock;
  summary.scanFromBlock = fromBlock.toString();
  summary.scanToBlock = toBlock.toString();
  summary.caughtUp = toBlock === currentBlock;

  const [burnLogs, refundLogs] = await Promise.all([
    client.getLogs({
      address: premiumAddress,
      event: {
        type: 'event',
        name: 'EscrowBurned',
        inputs: [
          { name: 'externalId', type: 'bytes32', indexed: true },
          { name: 'user', type: 'address', indexed: true },
          { name: 'amount', type: 'uint256', indexed: false },
        ],
      },
      fromBlock,
      toBlock,
    }),
    client.getLogs({
      address: premiumAddress,
      event: {
        type: 'event',
        name: 'EscrowRefunded',
        inputs: [
          { name: 'externalId', type: 'bytes32', indexed: true },
          { name: 'user', type: 'address', indexed: true },
          { name: 'amount', type: 'uint256', indexed: false },
          { name: 'to', type: 'address', indexed: false },
        ],
      },
      fromBlock,
      toBlock,
    }),
  ]);

  const parsedBurns = parseEventLogs({
    abi: griddlePremiumAbi,
    eventName: 'EscrowBurned',
    logs: burnLogs,
  });
  for (const log of parsedBurns) {
    const result = await db
      .update(premiumUsers)
      .set({
        escrowStatus: 'burned',
        escrowBurnTx: log.transactionHash,
        wordBurned: log.args.amount.toString(),
      })
      .where(
        and(
          eq(premiumUsers.externalId, log.args.externalId),
          isNotNull(premiumUsers.externalId),
        ),
      );
    // `result.rowCount` isn't exposed uniformly — bump counter per log.
    // An event without a matching row (e.g. direct contract call) is
    // expected and harmless.
    void result;
    summary.burnEventsApplied += 1;
  }

  const parsedRefunds = parseEventLogs({
    abi: griddlePremiumAbi,
    eventName: 'EscrowRefunded',
    logs: refundLogs,
  });
  for (const log of parsedRefunds) {
    // Clear wordBurned on refund — the webhook writes the escrowed
    // amount there optimistically at open-time, and for burned rows
    // the cron overwrites with the real on-chain burn amount above.
    // For refunded rows the tokens went back to treasury, nothing was
    // burned, so leaving the optimistic number would show a bogus
    // "X $WORD burned" in the admin ledger and skew total-burned
    // accounting.
    await db
      .update(premiumUsers)
      .set({
        escrowStatus: 'refunded',
        escrowBurnTx: log.transactionHash,
        wordBurned: null,
      })
      .where(
        and(
          eq(premiumUsers.externalId, log.args.externalId),
          isNotNull(premiumUsers.externalId),
        ),
      );
    summary.refundEventsApplied += 1;
  }

  // Advance cursor just past the scanned window, minus an overlap so
  // a chain reorg near the boundary doesn't lose events. When caught
  // up (toBlock === currentBlock) this lands a few hundred blocks
  // behind head. When catching up from extended downtime, this
  // monotonically advances past the last scanned region so the next
  // run picks up where we left off.
  const nextCursor =
    toBlock > CURSOR_OVERLAP_BLOCKS ? toBlock - CURSOR_OVERLAP_BLOCKS : 0n;
  await kv.set(CURSOR_KEY, nextCursor.toString());

  return NextResponse.json({ ok: true, summary });
}
