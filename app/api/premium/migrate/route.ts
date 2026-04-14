import { NextResponse } from 'next/server';
import { getSessionId } from '@/lib/session';
import { claimAndClearSessionPremium, setSessionPremium } from '@/lib/session-premium';
import { recordFiatUnlock } from '@/lib/db/queries';
import { isValidAddress } from '@/lib/address';

/**
 * POST /api/premium/migrate
 *
 * Body: `{ wallet: '0x…' }`
 *
 * Called by GameClient when a wallet connects and the session already
 * carries fiat premium (i.e. the user paid with Stripe before connecting
 * a wallet). Writes a `premium_users` row keyed on the wallet so that
 * subsequent wallet-keyed premium checks (`/api/premium/[wallet]`) see
 * the premium status — no need to check the session KV key on every load
 * after the wallet is linked.
 *
 * Idempotent: `recordFiatUnlock` uses `onConflictDoUpdate` so a retried
 * call just refreshes the existing row.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface MigrateBody {
  wallet?: string;
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: MigrateBody;
  try {
    body = (await req.json()) as MigrateBody;
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }

  const wallet = body.wallet;
  if (!wallet || !isValidAddress(wallet)) {
    return NextResponse.json({ error: 'valid wallet required' }, { status: 400 });
  }

  const sessionId = await getSessionId();

  // Atomically claim the migration slot: GETDEL returns the stored value
  // and deletes the key in one Redis operation. If two concurrent requests
  // race here, exactly one gets a non-null value and proceeds; the other
  // gets null and aborts — preventing a single payment from granting
  // premium_users rows to two different wallets.
  const sessionPremium = await claimAndClearSessionPremium(sessionId);

  if (!sessionPremium) {
    return NextResponse.json({ migrated: false, reason: 'no session premium' });
  }

  try {
    await recordFiatUnlock({
      stripeSessionId: sessionPremium.stripeSessionId,
      wallet: wallet.toLowerCase(),
    });
  } catch (err) {
    // DB write failed — restore the session key so the user doesn't lose
    // their premium record. They can retry migration later (on next wallet
    // connect) and the session check still works in the meantime.
    console.error('[premium/migrate] DB write failed, restoring session key', err);
    await setSessionPremium(sessionId, sessionPremium.stripeSessionId).catch(() => {
      // Best-effort restore. If this also fails, the Stripe session id is
      // still on the profiles row (via the webhook's upsertProfile call),
      // so the audit trail is intact even if the migration needs a retry.
      console.error('[premium/migrate] failed to restore session key');
    });
    return NextResponse.json({ error: 'migration failed, retry on next connect' }, { status: 500 });
  }

  return NextResponse.json({ migrated: true });
}
