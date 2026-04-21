import { NextResponse } from 'next/server';
import { createPublicClient, http, formatEther, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { requireAdminWallet } from '@/lib/admin';
import { db } from '@/lib/db/client';
import { oracleConfig } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * Admin oracle config + live status.
 *
 * GET  → current config row + on-chain state (price, updatedAt,
 *        stalenessSec) + updater EOA address & balance. Everything the
 *        /admin Oracle tab's status card needs.
 *
 * PATCH → update `pool_id` and/or `cron_enabled`. Changes take effect
 *        on the next cron tick (route re-reads config per invocation).
 *
 * Admin auth via requireAdminWallet — consistent with every other
 * admin route. Non-admins get 404 (not 401) so the route isn't a
 * directory probe.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ORACLE_VIEW_ABI = [
  {
    type: 'function',
    name: 'getWordUsdPrice',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'price', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'updater',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

export async function GET(): Promise<NextResponse> {
  const admin = await requireAdminWallet();
  if (!admin) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const rows = await db
    .select()
    .from(oracleConfig)
    .where(eq(oracleConfig.id, 1))
    .limit(1);
  const cfg = rows[0];

  // DB-first oracle address; env fallback preserves pre-UI deploys.
  const oracleAddress = (cfg?.oracleAddress ?? process.env.WORD_ORACLE_ADDRESS) as
    | Address
    | undefined;
  const rpcUrl = process.env.BASE_RPC_URL;
  const updaterKey = process.env.ORACLE_UPDATER_PRIVATE_KEY;

  // Compute the updater address from the private key so the admin UI
  // doesn't need it in env twice. Falls back to null if key isn't set
  // — the env-hygiene warning surfaces client-side instead.
  let updaterAddress: Address | null = null;
  if (updaterKey && /^0x[a-fA-F0-9]{64}$/.test(updaterKey)) {
    try {
      updaterAddress = privateKeyToAccount(updaterKey as `0x${string}`).address;
    } catch {/* malformed key; surfaces via null */}
  }

  const onChain: {
    price: string | null;
    updatedAt: number | null;
    stalenessSec: number | null;
    expectedUpdater: string | null;
    updaterBalanceEth: string | null;
    error: string | null;
  } = {
    price: null,
    updatedAt: null,
    stalenessSec: null,
    expectedUpdater: null,
    updaterBalanceEth: null,
    error: null,
  };

  if (!oracleAddress || !rpcUrl) {
    onChain.error = 'WORD_ORACLE_ADDRESS and/or BASE_RPC_URL not configured';
  } else {
    try {
      const client = createPublicClient({ chain: base, transport: http(rpcUrl) });
      const [priceData, expectedUpdater] = await Promise.all([
        client.readContract({
          address: oracleAddress,
          abi: ORACLE_VIEW_ABI,
          functionName: 'getWordUsdPrice',
        }),
        client.readContract({
          address: oracleAddress,
          abi: ORACLE_VIEW_ABI,
          functionName: 'updater',
        }),
      ]);
      const [price, updatedAt] = priceData;
      // price=0 && updatedAt=0 means setPrice has never been called.
      // Returning null for both lets the client render a clear
      // "never set" state rather than "$0 (0 wei), 0s ago" which
      // would mislead the operator into thinking the feed is live.
      if (price === 0n && updatedAt === 0n) {
        onChain.price = null;
        onChain.updatedAt = null;
        onChain.stalenessSec = null;
      } else {
        onChain.price = price.toString();
        onChain.updatedAt = Number(updatedAt);
        onChain.stalenessSec = Math.max(
          0,
          Math.floor(Date.now() / 1000) - Number(updatedAt),
        );
      }
      onChain.expectedUpdater = expectedUpdater;
      if (updaterAddress) {
        const balance = await client.getBalance({ address: updaterAddress });
        onChain.updaterBalanceEth = formatEther(balance);
      }
    } catch (err) {
      onChain.error = err instanceof Error ? err.message : String(err);
    }
  }

  return NextResponse.json({
    config: cfg
      ? {
          poolId: cfg.poolId,
          cronEnabled: cfg.cronEnabled,
          updatedAt: cfg.updatedAt,
          updatedBy: cfg.updatedBy,
        }
      : null,
    oracleAddress: oracleAddress ?? null,
    updaterAddress,
    onChain,
  });
}

export async function PATCH(req: Request): Promise<NextResponse> {
  const admin = await requireAdminWallet();
  if (!admin) return NextResponse.json({ error: 'not found' }, { status: 404 });

  let body: { poolId?: unknown; cronEnabled?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const patch: Record<string, unknown> = { updatedAt: new Date(), updatedBy: admin };

  if (typeof body.poolId === 'string') {
    const poolId = body.poolId.trim().toLowerCase();
    // GeckoTerminal pool ids are 0x + 64 hex chars for Uniswap v4
    // (the keccak of the PoolKey), or 42 chars for v3. Accept either.
    if (!/^0x[a-f0-9]{40,64}$/.test(poolId)) {
      return NextResponse.json(
        { error: 'poolId must be a 0x-prefixed hex string (40-64 chars)' },
        { status: 400 },
      );
    }
    patch.poolId = poolId;
  }
  if (typeof body.cronEnabled === 'boolean') {
    patch.cronEnabled = body.cronEnabled;
  }

  if (Object.keys(patch).length === 2) {
    // Only updatedAt + updatedBy — nothing to patch.
    return NextResponse.json({ error: 'no supported fields in body' }, { status: 400 });
  }

  await db.update(oracleConfig).set(patch).where(eq(oracleConfig.id, 1));

  return NextResponse.json({ ok: true });
}
