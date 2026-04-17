import { NextResponse } from 'next/server';
import { createPublicClient, createWalletClient, http, type Address, type Hex, erc20Abi } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { requireAdminWallet } from '@/lib/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WORD_ADDR: Address = '0x304e649e69979298BD1AEE63e175ADf07885fb4b';
const MAX_UINT256 = (2n ** 256n - 1n);

/**
 * POST /api/admin/deploy/approve-escrow
 *
 * Body: { premium: "0x..." }
 *
 * Server-side approve tx from the escrow manager EOA (private key
 * sits in Vercel env, never touches the admin UI). Signs
 * `WORD.approve(premium, type(uint256).max)` so the new
 * GriddlePremium contract can pull $WORD from the escrow stockpile
 * for the fiat path's `unlockForUser` flow.
 *
 * Idempotent — if the allowance is already MAX, returns noop=true
 * without sending a tx.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const admin = await requireAdminWallet();
  if (!admin) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const escrowPk = process.env.ESCROW_MANAGER_PRIVATE_KEY;
  if (!escrowPk) {
    return NextResponse.json(
      { error: 'ESCROW_MANAGER_PRIVATE_KEY not configured' },
      { status: 503 },
    );
  }

  let body: { premium?: string };
  try {
    body = (await req.json()) as { premium?: string };
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const premium = body.premium;
  if (typeof premium !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(premium)) {
    return NextResponse.json({ error: 'premium must be 0x-addr' }, { status: 400 });
  }

  const rpc = process.env.BASE_RPC_URL;
  if (!rpc) return NextResponse.json({ error: 'BASE_RPC_URL not set' }, { status: 503 });

  const normalized = (premium.startsWith('0x') ? premium : `0x${premium}`) as Address;
  const key = (escrowPk.startsWith('0x') ? escrowPk : `0x${escrowPk}`) as Hex;
  if (!/^0x[a-fA-F0-9]{64}$/.test(key)) {
    return NextResponse.json({ error: 'escrow key malformed' }, { status: 500 });
  }
  const account = privateKeyToAccount(key);

  const pub = createPublicClient({ chain: base, transport: http(rpc) });
  const existing = await pub.readContract({
    address: WORD_ADDR,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [account.address, normalized],
  });

  if (existing === MAX_UINT256) {
    return NextResponse.json({
      ok: true,
      noop: true,
      escrowEOA: account.address,
      allowance: existing.toString(),
    });
  }

  const wallet = createWalletClient({
    chain: base,
    transport: http(rpc),
    account,
  });

  const { request } = await pub.simulateContract({
    address: WORD_ADDR,
    abi: erc20Abi,
    functionName: 'approve',
    args: [normalized, MAX_UINT256],
    account,
  });
  const txHash = await wallet.writeContract(request);

  // Wait for 1 confirmation so the admin UI can verify allowance
  // before moving on to the next step.
  const receipt = await pub.waitForTransactionReceipt({ hash: txHash, confirmations: 1 });

  return NextResponse.json({
    ok: true,
    noop: false,
    escrowEOA: account.address,
    txHash,
    blockNumber: receipt.blockNumber.toString(),
  });
}
