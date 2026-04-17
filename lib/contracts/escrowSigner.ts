import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toBytes,
  type Address,
  type Hex,
} from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { griddlePremiumAbi } from './griddlePremiumAbi';
import { getGriddlePremiumAddress } from './addresses';

/**
 * Escrow-manager signer for the fiat path. Reads
 * `ESCROW_MANAGER_PRIVATE_KEY` server-side only (NEVER expose in a
 * `NEXT_PUBLIC_*` var) and wraps it in a viem WalletClient bound to
 * Base mainnet.
 *
 * The escrow manager EOA holds a pre-staged $WORD stockpile (500M +
 * 0.01 ETH at deploy time) and pre-approves the GriddlePremium
 * contract to pull from it. On every Stripe `checkout.session.completed`
 * the webhook calls `unlockForUser` using this signer.
 *
 * Lazy singleton so importing this module at build time doesn't blow
 * up when env vars aren't populated.
 */

function readKey(): Hex {
  const raw = process.env.ESCROW_MANAGER_PRIVATE_KEY;
  if (!raw) throw new Error('ESCROW_MANAGER_PRIVATE_KEY not set');
  // Accept either "0x…" or bare hex; normalize.
  const trimmed = raw.trim();
  const prefixed = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(prefixed)) {
    throw new Error('ESCROW_MANAGER_PRIVATE_KEY must be 0x + 64 hex chars');
  }
  return prefixed as Hex;
}

// Clients are cheap to construct (no network), so skip module-level
// caching. Keeps us clear of the viem type-duplication rabbit hole that
// the reown/walletconnect transitive deps reintroduce whenever we try
// to capture a viem client in a `let`.
function getPublicClient() {
  return createPublicClient({
    chain: base,
    transport: http(process.env.BASE_RPC_URL),
  });
}

function getWalletAndAccount() {
  const account = privateKeyToAccount(readKey());
  const wallet = createWalletClient({
    chain: base,
    transport: http(process.env.BASE_RPC_URL),
    account,
  });
  return { wallet, account };
}

/**
 * Derive the on-chain escrow key from a Stripe checkout session id.
 * Mirrors the contract's idempotency key so the admin ledger can join
 * an on-chain event back to the DB row without a reverse scan.
 */
export function externalIdForStripe(stripeSessionId: string): Hex {
  return keccak256(toBytes(stripeSessionId));
}

export interface OpenEscrowInput {
  user: Address;
  wordAmount: bigint;
  stripeSessionId: string;
}

export interface OpenEscrowResult {
  txHash: Hex;
  externalId: Hex;
}

/**
 * Submit `unlockForUser` on-chain for a paid Stripe session. Throws
 * on signer misconfiguration or RPC failure; the webhook catches and
 * enqueues for retry so Stripe still sees a 200.
 */
export async function openEscrowForFiatSession(
  input: OpenEscrowInput,
): Promise<OpenEscrowResult> {
  const premiumAddress = getGriddlePremiumAddress();
  if (!premiumAddress) throw new Error('GriddlePremium address not configured');

  const { wallet, account } = getWalletAndAccount();
  const publicClient = getPublicClient();

  const externalId = externalIdForStripe(input.stripeSessionId);

  // Simulate first so a revert (e.g. EscrowAlreadyExists on a Stripe
  // replay) surfaces as a typed error instead of a mined-but-reverted tx
  // that still costs gas. Viem's `simulateContract` returns the would-be
  // request; we feed that into `writeContract` to avoid re-encoding.
  const { request } = await publicClient.simulateContract({
    address: premiumAddress,
    abi: griddlePremiumAbi,
    functionName: 'unlockForUser',
    args: [input.user, input.wordAmount, externalId],
    account,
  });

  const txHash = await wallet.writeContract(request);
  return { txHash, externalId };
}
