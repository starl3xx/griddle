/**
 * Compiled artifact for PushedWordOracle.sol.
 *
 * Extracted from `contracts/out/PushedWordOracle.sol/PushedWordOracle.json`
 * (Foundry build output). Checked in rather than re-compiled at runtime so
 * the server can deploy the contract directly from the admin UI without
 * pulling the full Foundry toolchain into the Next.js build.
 *
 * Regenerate when the contract source changes:
 *
 *   cd contracts && forge build
 *   python3 -c "import json; d=json.load(open('out/PushedWordOracle.sol/PushedWordOracle.json')); print(d['bytecode']['object'])"
 *
 * …and paste the hex string into PUSHED_WORD_ORACLE_BYTECODE below.
 *
 * The ABI is a trimmed subset (what the deploy + runtime callers use);
 * keeping it minimal avoids tripping on the full Foundry ABI's custom
 * error entries in viem typegen.
 */

export const PUSHED_WORD_ORACLE_ABI = [
  {
    type: 'constructor',
    inputs: [{ name: 'updater_', type: 'address' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setPrice',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newPrice', type: 'uint256' }],
    outputs: [],
  },
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

// Solidity 0.8.24 · optimizer runs 1_000_000 · EVM version "paris".
// Must match contracts/out/PushedWordOracle.sol/PushedWordOracle.json.
export const PUSHED_WORD_ORACLE_BYTECODE =
  '0x60a060405234801561001057600080fd5b5060405161030538038061030583398101604081905261002f91610067565b6001600160a01b0381166100565760405163d92e233d60e01b815260040160405180910390fd5b6001600160a01b0316608052610097565b60006020828403121561007957600080fd5b81516001600160a01b038116811461009057600080fd5b9392505050565b60805161024d6100b86000396000818160c60152610125015261024d6000f3fe608060405234801561001057600080fd5b50600436106100675760003560e01c806391b7f5ed1161005057806391b7f5ed146100a3578063a035b1fe146100b8578063df034cd0146100c157600080fd5b80632d70c8a61461006c5780637519ab501461008c575b600080fd5b600054600154604080519283526020830191909152015b60405180910390f35b61009560015481565b604051908152602001610083565b6100b66100b13660046101fe565b61010d565b005b61009560005481565b6100e87f000000000000000000000000000000000000000000000000000000000000000081565b60405173ffffffffffffffffffffffffffffffffffffffff9091168152602001610083565b3373ffffffffffffffffffffffffffffffffffffffff7f0000000000000000000000000000000000000000000000000000000000000000161461017c576040517f9a280f3900000000000000000000000000000000000000000000000000000000815260040160405180910390fd5b806000036101b6576040517f4dfba02300000000000000000000000000000000000000000000000000000000815260040160405180910390fd5b60008190554260018190556040805183815260208101929092527f945c1c4e99aa89f648fbfe3df471b916f719e16d960fcec0737d4d56bd696838910160405180910390a150565b60006020828403121561021057600080fd5b503591905056fea264697066735822122072a6ab1df7f903e9a4a49b79d170a6fb57998248f71bbaf53d895c9700d3b86364736f6c63430008180033' as const;
