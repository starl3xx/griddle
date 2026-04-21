import { NextResponse } from 'next/server';
import { createPublicClient, createWalletClient, http, type Hex, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { db } from '@/lib/db/client';
import { oracleConfig } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * Vercel cron → /api/cron/oracle-update
 *
 * Runs every 2 minutes (schedule in vercel.json). Reads the current
 * $WORD/USDC price from GeckoTerminal and pushes it to the on-chain
 * PushedWordOracle so GriddlePremium's 5-minute staleness check always
 * has a fresh reading, regardless of whether LHAW's own cron is up.
 *
 * Why a cron + a pushed feed rather than an on-chain TWAP: $WORD lives
 * in a Clanker v4 pool on Uniswap v4 which has no observation hook, so
 * there's no manipulation-resistant on-chain read available for this
 * token. GeckoTerminal indexes the pool off-chain and we re-publish
 * that number on-chain. See contracts/src/PushedWordOracle.sol for the
 * full trust model.
 *
 * Config source: `oracle_config` row id=1 (pool_id + cron_enabled).
 * Read every invocation so admin UI edits take effect on the next tick
 * without a redeploy.
 *
 * Auth: `Authorization: Bearer $CRON_SECRET`. Vercel's scheduler sets
 * this header automatically when CRON_SECRET is defined in env; hitting
 * the route from anywhere else requires the same header. Manual
 * force-update from /admin goes through `/api/admin/oracle/force-update`
 * instead — same internals, different auth (admin wallet).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface OracleUpdateResult {
  ok: boolean;
  skipped?: string;
  error?: string;
  priceUsd?: number;
  priceWei?: string;
  txHash?: string;
  poolId?: string;
}

const ORACLE_ABI = [
  {
    type: 'function',
    name: 'setPrice',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newPrice', type: 'uint256' }],
    outputs: [],
  },
] as const;

export async function GET(req: Request): Promise<NextResponse<OracleUpdateResult>> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET not configured' },
      { status: 503 },
    );
  }
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  return runOraclePush({ forced: false });
}

/**
 * Shared internals — invoked by the cron GET above and by the admin
 * force-update POST. Caller is responsible for authentication; this
 * function trusts its invocation.
 *
 * `forced: true` bypasses the `cron_enabled` toggle so admins can kick
 * a push while the regular cron is paused (useful for verifying the
 * pipeline end-to-end before flipping the toggle on).
 */
export async function runOraclePush(
  opts: { forced: boolean },
): Promise<NextResponse<OracleUpdateResult>> {
  const oracleAddress = process.env.WORD_ORACLE_ADDRESS as Address | undefined;
  const updaterKey = process.env.ORACLE_UPDATER_PRIVATE_KEY;
  const rpcUrl = process.env.BASE_RPC_URL;

  if (!oracleAddress || !/^0x[a-fA-F0-9]{40}$/.test(oracleAddress)) {
    return NextResponse.json(
      { ok: false, error: 'WORD_ORACLE_ADDRESS not set or invalid' },
      { status: 503 },
    );
  }
  if (!updaterKey || !/^0x[a-fA-F0-9]{64}$/.test(updaterKey)) {
    return NextResponse.json(
      { ok: false, error: 'ORACLE_UPDATER_PRIVATE_KEY not set or invalid' },
      { status: 503 },
    );
  }
  if (!rpcUrl) {
    return NextResponse.json(
      { ok: false, error: 'BASE_RPC_URL not set' },
      { status: 503 },
    );
  }

  // Pull the current config. Single-row table; missing row is a bug
  // (the 0022 migration seeds id=1) so treat it as a hard error.
  const rows = await db
    .select()
    .from(oracleConfig)
    .where(eq(oracleConfig.id, 1))
    .limit(1);
  const cfg = rows[0];
  if (!cfg) {
    return NextResponse.json(
      { ok: false, error: 'oracle_config row missing (expected id=1 from 0022 migration)' },
      { status: 500 },
    );
  }

  if (!opts.forced && !cfg.cronEnabled) {
    return NextResponse.json(
      { ok: true, skipped: 'cron_disabled', poolId: cfg.poolId },
      { status: 200 },
    );
  }

  // Fetch the current price from GeckoTerminal. No API key required;
  // their free tier is fine for ~720 calls/day (our 2-min cron volume).
  // We read `base_token_price_usd` which is the price of the *first*
  // token in the pool (`base_token`) in USD. For a $WORD/WETH pool,
  // base_token is $WORD — so the string is USD-per-$WORD directly.
  const apiUrl = `https://api.geckoterminal.com/api/v2/networks/base/pools/${cfg.poolId}`;
  let priceUsd: number;
  try {
    const res = await fetch(apiUrl, {
      headers: { accept: 'application/json' },
      // Vercel edge is stricter about caching than defaults; bust it.
      cache: 'no-store',
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `GeckoTerminal ${res.status}`, poolId: cfg.poolId },
        { status: 502 },
      );
    }
    const body = (await res.json()) as {
      data?: { attributes?: { base_token_price_usd?: string } };
    };
    const priceStr = body.data?.attributes?.base_token_price_usd;
    if (!priceStr) {
      return NextResponse.json(
        { ok: false, error: 'GeckoTerminal returned no base_token_price_usd', poolId: cfg.poolId },
        { status: 502 },
      );
    }
    priceUsd = parseFloat(priceStr);
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
      return NextResponse.json(
        { ok: false, error: `bad price from GeckoTerminal: ${priceStr}`, poolId: cfg.poolId },
        { status: 502 },
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: `GeckoTerminal fetch failed: ${msg}`, poolId: cfg.poolId },
      { status: 502 },
    );
  }

  // Convert to 18-decimal wei. $0.000123 → 1.23e14 wei. Use BigInt
  // end-to-end; Number arithmetic on sub-cent prices loses precision.
  // Strategy: scale the float to micro-USD integer (6-dec), then pad
  // to 18-dec with × 1e12. Accepts up to ~15 significant digits from
  // GeckoTerminal which is more than enough for our slippage floor.
  const priceWei = BigInt(Math.round(priceUsd * 1e12)) * 10n ** 6n;
  if (priceWei === 0n) {
    // Rounded to zero — underflow at the 1e-12 boundary. Extremely
    // low-priced tokens could hit this; $WORD is nowhere near.
    return NextResponse.json(
      { ok: false, error: `priceUsd=${priceUsd} rounds to zero in 18-dec`, priceUsd, poolId: cfg.poolId },
      { status: 500 },
    );
  }

  // Push on-chain. viem handles gas estimation + nonce automatically.
  const account = privateKeyToAccount(updaterKey as Hex);
  const wallet = createWalletClient({
    chain: base,
    transport: http(rpcUrl),
    account,
  });
  const publicClient = createPublicClient({
    chain: base,
    transport: http(rpcUrl),
  });

  try {
    const hash = await wallet.writeContract({
      address: oracleAddress,
      abi: ORACLE_ABI,
      functionName: 'setPrice',
      args: [priceWei],
    });
    // Don't await receipt confirmation — the cron doesn't care about
    // confirmations for its own workflow and waiting would eat most of
    // the 2-minute budget. Next invocation confirms implicitly by
    // reading the new `updatedAt` off-chain.
    void publicClient;
    return NextResponse.json({
      ok: true,
      priceUsd,
      priceWei: priceWei.toString(),
      txHash: hash,
      poolId: cfg.poolId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: `setPrice tx failed: ${msg}`, priceUsd, poolId: cfg.poolId },
      { status: 502 },
    );
  }
}
