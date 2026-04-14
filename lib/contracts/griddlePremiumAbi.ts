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
    name: 'unlockWithPermit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenAmount', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
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
    name: 'SLIPPAGE_PCT',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'UnlockedWithBurn',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'tokensBurned', type: 'uint256', indexed: false },
      { name: 'oraclePrice', type: 'uint256', indexed: false },
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
