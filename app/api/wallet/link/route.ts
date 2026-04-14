import { NextResponse } from 'next/server';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { solves } from '@/lib/db/schema';
import { getSessionId } from '@/lib/session';

/**
 * POST /api/wallet/link
 *
 * Body: `{ wallet: "0x..." }`
 *
 * Retroactively attributes all anonymous solves on the current session
 * to the given wallet. This runs once when a user connects their
 * wallet for the first time on a session — every solve they made
 * before connecting becomes wallet-attributed.
 *
 * Sets `solves.wallet = ?` for rows where `session_id = current` AND
 * `wallet IS NULL`. Existing wallet attributions are NOT overwritten
 * (defensive against a session that's already been linked to a
 * different wallet, which shouldn't happen but isn't worth crashing on).
 *
 * In M4f when the premium burn lands, this same endpoint will also
 * trigger a stream of leaderboard recomputes. For M4c it's pure
 * backfill — no other side effects.
 *
 * Note: this endpoint accepts the wallet from the request body without
 * verification (no signature). That's intentional for M4c — wallet
 * authentication via SIWE / signed message can come in M5 if we ever
 * need to prove ownership beyond "the user told us." The risk surface
 * is "user A claims wallet B's anonymous solves," which is a credit
 * theft of work the legitimate wallet owner never did anyway. Low
 * stakes; not worth the extra signing dance pre-launch.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<NextResponse> {
  let body: { wallet?: string };
  try {
    body = (await req.json()) as { wallet?: string };
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  if (!body.wallet || !isValidAddress(body.wallet)) {
    return NextResponse.json({ error: 'invalid wallet address' }, { status: 400 });
  }

  const sessionId = await getSessionId();
  const normalized = body.wallet.toLowerCase();

  const result = await db
    .update(solves)
    .set({ wallet: normalized })
    .where(and(eq(solves.sessionId, sessionId), isNull(solves.wallet)))
    .returning({ id: solves.id });

  return NextResponse.json({
    wallet: normalized,
    sessionId,
    linked: result.length,
  });
}

function isValidAddress(s: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(s);
}
