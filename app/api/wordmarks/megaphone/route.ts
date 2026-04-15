import { NextResponse } from 'next/server';
import { getSessionId } from '@/lib/session';
import { getSessionWallet } from '@/lib/wallet-session';
import { insertWordmarksIfNew } from '@/lib/db/queries';

/**
 * POST /api/wordmarks/megaphone
 *
 * Client-side award path for the Megaphone wordmark. Fired from
 * SolveModal's share handler only after a share action has actually
 * been confirmed (composeCast returned 'cast', navigator.share
 * resolved, or clipboard writeText resolved). Cancels + errors do
 * NOT call this endpoint.
 *
 * Requires a wallet bound to the session — anonymous users can
 * still share, but the wordmark only lands on a wallet-keyed
 * profile. No premium gate: sharing is a free action regardless
 * of upgrade state.
 *
 * Idempotent via the `(wallet, wordmark_id)` unique index on the
 * wordmarks table, so a user spamming the share button doesn't
 * create extra rows or inflate the earn count. The response
 * distinguishes "earned just now" from "already earned previously"
 * via the `firstTime` boolean so the client can conditionally show
 * the earn toast.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  const sessionId = await getSessionId();
  const wallet = await getSessionWallet(sessionId);
  if (!wallet) {
    return NextResponse.json(
      { error: 'wallet required to earn wordmarks' },
      { status: 401 },
    );
  }

  const inserted = await insertWordmarksIfNew(wallet, ['megaphone'], null);
  return NextResponse.json({
    wordmarkId: 'megaphone',
    firstTime: inserted.length > 0,
  });
}
