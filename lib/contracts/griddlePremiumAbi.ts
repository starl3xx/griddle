/**
 * Minimal ABI for GriddlePremium — only the functions and events the
 * client uses. Keeping this narrow avoids pulling in the full artifact
 * blob and makes it obvious at the call site what surface we're using.
 *
 * Full contract source: contracts/src/GriddlePremium.sol
 */
export const griddlePremiumAbi = [
  {
    type: 'function',
    name: 'unlockWithUsdc',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'permitDeadline', type: 'uint256' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
      { name: 'minWordOut', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'unlockForUser',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'externalId', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'burnEscrowed',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'externalId', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'isPremium',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'oracle',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'UNLOCK_USD',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'USDC_UNLOCK_AMOUNT',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'SWAP_SLIPPAGE_PCT',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'UnlockedWithUsdcSwap',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'usdcIn', type: 'uint256', indexed: false },
      { name: 'wordBurned', type: 'uint256', indexed: false },
      { name: 'oraclePrice', type: 'uint256', indexed: false },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'EscrowOpened',
    inputs: [
      { name: 'externalId', type: 'bytes32', indexed: true },
      { name: 'user', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'EscrowBurned',
    inputs: [
      { name: 'externalId', type: 'bytes32', indexed: true },
      { name: 'user', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'EscrowRefunded',
    inputs: [
      { name: 'externalId', type: 'bytes32', indexed: true },
      { name: 'user', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'to', type: 'address', indexed: false },
    ],
    anonymous: false,
  },
] as const;

/**
 * WordOracle interface — we only need `getWordUsdPrice()` to compute the
 * target token amount client-side before signing the permit.
 */
export const wordOracleAbi = [
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
] as const;

/**
 * USDC ABI fragment — permit domain + nonces for the ERC-2612 signature
 * the crypto flow uses.
 */
export const usdcAbi = [
  {
    type: 'function',
    name: 'name',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'version',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'nonces',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;
