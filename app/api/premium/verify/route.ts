import { NextResponse } from 'next/server';
import { createPublicClient, http, parseEventLogs } from 'viem';
import { base } from 'viem/chains';
import { griddlePremiumAbi } from '@/lib/contracts/griddlePremiumAbi';
import { getGriddlePremiumAddress } from '@/lib/contracts/addresses';
import { recordCryptoUnlock } from '@/lib/db/queries';
import { recordFunnelEvent } from '@/lib/funnel/record';
import { getSessionId } from '@/lib/session';
import { isValidAddress } from '@/lib/address';
import { checkRateLimit, rateLimitResponseInit } from '@/lib/rate-limit';
import { validateUsername } from '@/lib/username';
import { isValidEmail, normalizeEmail } from '@/lib/email';

/**
 * POST /api/premium/verify
 *
 * Body: `{ txHash: '0x…' }`
 *
 * Called by the client after `unlockWithUsdc` lands on-chain. The
 * client-supplied wallet / amount are NOT trusted — this route reads
 * the transaction receipt from a public Base RPC and parses the
 * `UnlockedWithUsdcSwap` event emitted by our GriddlePremium contract.
 * That gives us four independent facts from the chain itself:
 *
 *   1. The tx was included in a successful block
 *   2. The emitting contract is our configured GriddlePremium address
 *   3. The `user` indexed arg of the event is the real payer
 *   4. The `usdcIn` + `wordBurned` fields are the actual amounts, not
 *      client claims — these feed the admin Transactions ledger.
 *
 * If all four check out we upsert the premium_users row with payment
 * telemetry and echo back `{premium: true, wallet}`. Otherwise we
 * reject with a 400 and no DB write happens — the client may retry.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const publicClient = createPublicClient({
  chain: base,
  transport: http(),
});

interface VerifyBody {
  txHash?: string;
  /**
   * Handle the player chose in the inline unlock form. Required when
   * no profile yet exists for this wallet (so we have a second identity
   * anchor alongside the wallet). Client MAY still send it on repeat
   * unlocks — validated + ignored if it would collide with another
   * profile's handle.
   */
  handle?: string;
  /**
   * Optional email from the inline unlock form. Stored on
   * `premium_users.email` and `profiles.email`. When present it
   * becomes the durable claim anchor for later magic-link sign-in on
   * a different device.
   */
  email?: string;
}

export async function POST(req: Request): Promise<NextResponse> {
  const premiumAddress = getGriddlePremiumAddress();
  if (!premiumAddress) {
    return NextResponse.json(
      { error: 'griddle premium contract not deployed / env var unset' },
      { status: 503 },
    );
  }

  let body: VerifyBody;
  try {
    body = (await req.json()) as VerifyBody;
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }

  const txHash = body.txHash;
  if (typeof txHash !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    return NextResponse.json({ error: 'txHash must be 0x + 64 hex' }, { status: 400 });
  }

  // Optional handle — validated here rather than deeper in the stack
  // so a bad handle rejects with 400 before we kick off a receipt
  // read. Null when the client didn't collect one (signed-in user with
  // a profile already, or pre-M6 client that doesn't know about the
  // inline form).
  let handle: string | null = null;
  if (typeof body.handle === 'string' && body.handle.trim().length > 0) {
    const normalized = body.handle.trim().toLowerCase();
    const validation = validateUsername(normalized);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error ?? 'invalid handle' },
        { status: 400 },
      );
    }
    handle = normalized;
  }

  // Optional email — same permissive stance. A malformed email is
  // still a 400 (typo caught early beats a silently-dropped claim
  // anchor) but omitting it entirely is fine: handle + wallet already
  // give us two anchors on the crypto path.
  let email: string | null = null;
  if (typeof body.email === 'string' && body.email.trim().length > 0) {
    if (!isValidEmail(body.email)) {
      return NextResponse.json({ error: 'invalid email' }, { status: 400 });
    }
    email = normalizeEmail(body.email);
  }

  const sessionId = await getSessionId();
  const rl = await checkRateLimit(`premium-verify:${sessionId}`, 10, 60);
  if (!rl.allowed) {
    return new NextResponse(
      JSON.stringify({ error: 'too many verify attempts, slow down' }),
      rateLimitResponseInit(rl),
    );
  }

  let receipt: Awaited<ReturnType<typeof publicClient.getTransactionReceipt>>;
  try {
    receipt = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
  } catch {
    return NextResponse.json(
      { error: 'transaction not yet indexed; retry shortly' },
      { status: 404 },
    );
  }

  if (receipt.status !== 'success') {
    return NextResponse.json({ error: 'transaction reverted' }, { status: 400 });
  }

  const ourLogs = receipt.logs.filter(
    (l) => l.address.toLowerCase() === premiumAddress,
  );
  if (ourLogs.length === 0) {
    return NextResponse.json(
      { error: 'transaction did not emit a GriddlePremium event' },
      { status: 400 },
    );
  }

  const parsed = parseEventLogs({
    abi: griddlePremiumAbi,
    eventName: 'UnlockedWithUsdcSwap',
    logs: ourLogs,
  });

  if (parsed.length === 0) {
    return NextResponse.json(
      { error: 'no UnlockedWithUsdcSwap event in transaction' },
      { status: 400 },
    );
  }

  const event = parsed[0];
  const wallet = event.args.user.toLowerCase();
  const usdcIn = event.args.usdcIn;
  const wordBurned = event.args.wordBurned;

  if (!isValidAddress(wallet)) {
    return NextResponse.json({ error: 'event user is not a valid address' }, { status: 400 });
  }

  try {
    await recordCryptoUnlock({
      wallet,
      txHash,
      usdcAmount: usdcIn,
      wordBurned,
      handle,
      email,
    });
  } catch (err) {
    // Handle collisions (another profile owns the requested handle) show
    // up here as a Postgres unique-violation from upsertProfile. Surface
    // as a 409 so the client can ask the user to pick a different
    // username without failing the whole unlock — the on-chain burn
    // already happened, so premium is real either way.
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('profiles_handle_lower_idx') || msg.includes('23505')) {
      return NextResponse.json(
        { error: 'That username is taken.', code: 'handle_taken', wallet, txHash },
        { status: 409 },
      );
    }
    console.error('[premium/verify] recordCryptoUnlock failed', err);
    return NextResponse.json(
      { error: 'failed to record unlock' },
      { status: 500 },
    );
  }

  try {
    await recordFunnelEvent(
      { name: 'checkout_completed', method: 'crypto' },
      { sessionId, wallet, idempotencyKey: `crypto:${txHash}` },
    );
  } catch (err) {
    console.warn('[premium/verify] funnel telemetry emit failed', err);
  }

  return NextResponse.json({ premium: true, wallet, txHash });
}
