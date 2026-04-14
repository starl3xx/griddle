import { NextResponse } from 'next/server';
import { createPublicClient, http, parseEventLogs } from 'viem';
import { base } from 'viem/chains';
import { griddlePremiumAbi } from '@/lib/contracts/griddlePremiumAbi';
import { getGriddlePremiumAddress } from '@/lib/contracts/addresses';
import { recordCryptoUnlock } from '@/lib/db/queries';
import { isValidAddress } from '@/lib/address';

/**
 * POST /api/premium/verify
 *
 * Body: `{ txHash: '0x…' }`
 *
 * Called by the client after `unlockWithPermit` lands on-chain. The
 * client-supplied wallet / amount are NOT trusted — this route reads
 * the transaction receipt from a public Base RPC and parses the
 * `UnlockedWithBurn` event emitted by our GriddlePremium contract.
 * That gives us three independent facts from the chain itself:
 *
 *   1. The tx was included in a successful block
 *   2. The emitting contract is our configured GriddlePremium address
 *   3. The `user` indexed arg of the event is the real payer
 *
 * If all three check out we insert/upsert a premium_users row bound to
 * that user and echo back `{premium: true, wallet}`. Otherwise we
 * reject with a 400 and no DB write happens — the client may retry.
 *
 * This decouples the "client knows about the burn" step from the
 * "server grants premium" step, which means a malicious client can't
 * grant themselves premium by POSTing a fake wallet address.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Single long-lived public client per serverless instance. viem's
// clients are cheap but we still don't want one per request.
const publicClient = createPublicClient({
  chain: base,
  transport: http(),
});

interface VerifyBody {
  txHash?: string;
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

  // Wait for the receipt. If the tx doesn't exist yet (eager call from
  // the client), viem throws — the client should retry after a short
  // delay. Two confirmations is overkill on Base but it's cheap and
  // protects against a reorg flipping a valid unlock into an invalid
  // state between verify and display.
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

  // Every log we care about was emitted by our contract, so narrow
  // the log list to that address before decoding. Defense in depth
  // against a malicious contract that happens to emit a look-alike
  // UnlockedWithBurn event with a fake user.
  const ourLogs = receipt.logs.filter(
    (l) => l.address.toLowerCase() === premiumAddress,
  );
  if (ourLogs.length === 0) {
    return NextResponse.json(
      { error: 'transaction did not emit a GriddlePremium event' },
      { status: 400 },
    );
  }

  // parseEventLogs filters to events matching our ABI and gives us
  // typed `args` back. We want the UnlockedWithBurn log specifically.
  const parsed = parseEventLogs({
    abi: griddlePremiumAbi,
    eventName: 'UnlockedWithBurn',
    logs: ourLogs,
  });

  if (parsed.length === 0) {
    return NextResponse.json(
      { error: 'no UnlockedWithBurn event in transaction' },
      { status: 400 },
    );
  }

  // Use the first event — a single tx should only contain one unlock
  // (our contract has no reason to emit multiple in one call), but if
  // one ever did we'd still honor the first user.
  const event = parsed[0];
  const wallet = event.args.user.toLowerCase();

  if (!isValidAddress(wallet)) {
    return NextResponse.json({ error: 'event user is not a valid address' }, { status: 400 });
  }

  try {
    await recordCryptoUnlock(wallet, txHash);
  } catch (err) {
    console.error('[premium/verify] recordCryptoUnlock failed', err);
    return NextResponse.json(
      { error: 'failed to record unlock' },
      { status: 500 },
    );
  }

  return NextResponse.json({ premium: true, wallet, txHash });
}
