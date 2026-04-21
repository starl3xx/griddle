import { NextResponse } from 'next/server';
import { createPublicClient, createWalletClient, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { eq } from 'drizzle-orm';
import { requireAdminWallet } from '@/lib/admin';
import { db } from '@/lib/db/client';
import { oracleConfig } from '@/lib/db/schema';
import {
  PUSHED_WORD_ORACLE_ABI,
  PUSHED_WORD_ORACLE_BYTECODE,
} from '@/lib/contracts/pushedWordOracleArtifact';

/**
 * POST /api/admin/oracle/deploy
 *
 * Admin-only one-click deploy for the PushedWordOracle contract.
 *
 * Flow:
 *   1. Connect the updater wallet (the existing ORACLE_UPDATER_PRIVATE_KEY
 *      in Vercel env — same EOA that signs setPrice calls every 2 min).
 *   2. Send a contract-creation tx with the PushedWordOracle bytecode,
 *      constructor arg = updater address. The deployer doesn't need any
 *      special privileges (the contract has no `owner`), so reusing the
 *      updater EOA keeps us from managing another hot wallet.
 *   3. Wait for the receipt so we capture the deployed address.
 *   4. Persist the address to oracle_config.oracle_address. The cron +
 *      admin status endpoints read from there first, env as fallback.
 *
 * The final migration step — GriddlePremium.setOracle(newAddress) — is
 * NOT done here because it requires the contract owner's signature,
 * which the server can't produce. The UI surfaces a copy-pasteable
 * `cast send` command the operator runs with the owner wallet.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  const admin = await requireAdminWallet();
  if (!admin) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const updaterKey = process.env.ORACLE_UPDATER_PRIVATE_KEY;
  const rpcUrl = process.env.BASE_RPC_URL;

  if (!updaterKey || !/^0x[a-fA-F0-9]{64}$/.test(updaterKey)) {
    return NextResponse.json(
      { error: 'ORACLE_UPDATER_PRIVATE_KEY not set or invalid' },
      { status: 503 },
    );
  }
  if (!rpcUrl) {
    return NextResponse.json(
      { error: 'BASE_RPC_URL not set' },
      { status: 503 },
    );
  }

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

  // Sanity-check the EOA has gas before we even broadcast — a clearer
  // error surfaces in the UI than waiting for the viem balance error.
  const balance = await publicClient.getBalance({ address: account.address });
  if (balance === 0n) {
    return NextResponse.json(
      {
        error: `Updater EOA ${account.address} has zero ETH. Fund it (~0.0005 Base ETH) and retry.`,
      },
      { status: 400 },
    );
  }

  let txHash: Hex;
  try {
    txHash = await wallet.deployContract({
      abi: PUSHED_WORD_ORACLE_ABI,
      bytecode: PUSHED_WORD_ORACLE_BYTECODE,
      args: [account.address],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `deploy tx failed: ${msg}` },
      { status: 502 },
    );
  }

  // Wait for the deployment to land so we can return the contract
  // address. Base mainnet averages ~2s blocks, so a 30s timeout gives
  // ~15 confirmation windows' worth of headroom before we bail out
  // (which would leave the admin to recover from the tx hash alone).
  let contractAddress: `0x${string}` | null = null;
  try {
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      timeout: 30_000,
    });
    contractAddress = receipt.contractAddress ?? null;
    if (!contractAddress) {
      return NextResponse.json(
        { error: 'receipt had no contractAddress — deploy may have reverted', txHash },
        { status: 502 },
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: `deploy receipt timeout: ${msg}. Tx may still confirm; check BaseScan.`,
        txHash,
      },
      { status: 504 },
    );
  }

  // Persist. Lowercase the address for consistency with every other
  // wallet column in the DB.
  await db
    .update(oracleConfig)
    .set({
      oracleAddress: contractAddress.toLowerCase(),
      updatedAt: new Date(),
      updatedBy: admin,
    })
    .where(eq(oracleConfig.id, 1));

  return NextResponse.json({
    ok: true,
    oracleAddress: contractAddress,
    updaterAddress: account.address,
    txHash,
  });
}
