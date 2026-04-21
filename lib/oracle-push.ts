import { NextResponse } from 'next/server';
import { createWalletClient, http, type Hex, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { db } from '@/lib/db/client';
import { oracleConfig } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * Shared implementation of the "fetch GeckoTerminal → setPrice" push.
 *
 * Two callers, different auth:
 *   - /api/cron/oracle-update (Vercel every-2-min cron, Bearer CRON_SECRET)
 *   - /api/admin/oracle/force-update (admin wallet gate)
 *
 * Lives in /lib rather than inside either route because Next.js App
 * Router only accepts specific named exports from route.ts files
 * (GET / POST / PATCH / etc.); an additional helper export fails the
 * build with "X is not a valid Route export field".
 *
 * `forced: true` bypasses the `cron_enabled` toggle so admins can run
 * a one-off push while the regular cron is paused (useful for
 * verifying the pipeline before flipping the toggle on).
 */

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

export async function runOraclePush(
  opts: { forced: boolean },
): Promise<NextResponse<OracleUpdateResult>> {
  const updaterKey = process.env.ORACLE_UPDATER_PRIVATE_KEY;
  const rpcUrl = process.env.BASE_RPC_URL;

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

  // DB is the source of truth for the deployed oracle address. Falls
  // back to WORD_ORACLE_ADDRESS env var so a pre-UI manual deploy still
  // works. Admin UI's deploy route writes oracle_config.oracleAddress.
  const oracleAddress = (cfg.oracleAddress ?? process.env.WORD_ORACLE_ADDRESS) as
    | Address
    | undefined;
  if (!oracleAddress || !/^0x[a-fA-F0-9]{40}$/.test(oracleAddress)) {
    return NextResponse.json(
      { ok: false, error: 'oracle address not set (deploy from /admin → Oracle)' },
      { status: 503 },
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
  // Strategy: scale the float to pico-USD integer (12-dec), then pad
  // to 18-dec with × 1e6. Accepts up to ~15 significant digits from
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
