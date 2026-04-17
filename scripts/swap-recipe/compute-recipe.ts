/**
 * Compute the Universal Router recipe (commands + inputs) for a $5
 * USDC → $WORD swap on Base mainnet, using Uniswap's own
 * universal-router-sdk. The output bytes are what you pass to
 * `GriddlePremium.setSwapConfig()` right after deploy.
 *
 * Run:
 *   BASE_RPC_URL=https://... bun run scripts/swap-recipe/compute-recipe.ts
 *
 * Prints:
 *   commands (hex bytes) and inputs[] (hex bytes array), plus the
 *   expected WORD output for a $5 trade at current pool state.
 */

import { ethers } from 'ethers';
import { TradeType, Ether, Token, CurrencyAmount, Percent } from '@uniswap/sdk-core';
import {
  RouterTradeAdapter,
  SwapRouter,
  PoolType,
  type PartialClassicQuote,
  UNIVERSAL_ROUTER_ADDRESS,
  UniversalRouterVersion,
} from '@uniswap/universal-router-sdk';

// ---------- Base mainnet addresses ----------
const CHAIN_ID = 8453;
const USDC     = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const WETH     = '0x4200000000000000000000000000000000000006';
const WORD     = '0x304e649e69979298BD1AEE63e175ADf07885fb4b';

// V3 USDC/WETH 0.05% pool (observed in fork-test V3 leg).
const V3_USDC_WETH_005 = '0xd0b53D9277642d899DF5C87A3966A349A798F224';
// Uniswap v4 StateView on Base — convenience reader for pool state.
// Address from Uniswap deployments docs; falls back to PoolManager
// extsload if this proves wrong at call time.
const V4_STATE_VIEW   = '0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71';
// WORD/WETH v4 pool params (discovered via Initialize event on Base v4 PoolManager).
const WORD_HOOK       = '0xd60D6B218116cFd801E28F78d011a203D2b068Cc';
const WORD_FEE        = 0x800000;            // DYNAMIC_FEE_FLAG
const WORD_TICK_SPACING = 200;

// ---------- ABIs we need ----------
const V3_POOL_ABI = [
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 obIndex, uint16 obCard, uint16 obCardNext, uint8 feeProtocol, bool unlocked)',
  'function liquidity() view returns (uint128)',
  'function fee() view returns (uint24)',
] as const;

// StateView exposes pool reads without needing extsload byte-math.
const STATE_VIEW_ABI = [
  'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
  'function getLiquidity(bytes32 poolId) view returns (uint128)',
] as const;

// ---------- Main ----------
const JSON_MODE = process.argv.includes('--json');
const log = (...args: unknown[]) => {
  if (!JSON_MODE) console.log(...args);
};

async function main() {
  const rpc = process.env.BASE_RPC_URL;
  if (!rpc) throw new Error('BASE_RPC_URL not set');
  const provider = new ethers.providers.JsonRpcProvider(rpc);

  // 1) Fetch V3 USDC/WETH pool state
  const v3 = new ethers.Contract(V3_USDC_WETH_005, V3_POOL_ABI, provider);
  const [v3Slot0, v3Liq, v3Fee] = await Promise.all([
    v3.slot0(),
    v3.liquidity(),
    v3.fee(),
  ]);
  const v3SqrtPriceX96 = v3Slot0.sqrtPriceX96.toString();
  const v3Tick = v3Slot0.tick.toString();
  log('V3 USDC/WETH pool:', {
    sqrtPriceX96: v3SqrtPriceX96,
    tick: v3Tick,
    liquidity: v3Liq.toString(),
    fee: v3Fee.toString(),
  });

  // 2) Compute WORD/WETH v4 poolId + fetch state via StateView
  // PoolKey ABI-encode order matches v4-core: (currency0, currency1, fee, tickSpacing, hooks)
  const [c0, c1] =
    BigInt(WORD) < BigInt(WETH) ? [WORD, WETH] : [WETH, WORD];
  const poolId = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ['address', 'address', 'uint24', 'int24', 'address'],
      [c0, c1, WORD_FEE, WORD_TICK_SPACING, WORD_HOOK],
    ),
  );
  log('WORD v4 poolId:', poolId);

  const stateView = new ethers.Contract(V4_STATE_VIEW, STATE_VIEW_ABI, provider);
  const [v4Slot0, v4Liq] = await Promise.all([
    stateView.getSlot0(poolId),
    stateView.getLiquidity(poolId),
  ]);
  log('V4 WORD/WETH pool:', {
    sqrtPriceX96: v4Slot0.sqrtPriceX96.toString(),
    tick: v4Slot0.tick.toString(),
    liquidity: v4Liq.toString(),
  });

  // 3) Estimate hop amounts from sqrtPriceX96. The adapter only needs
  //    amountIn on the first hop and amountOut on the last hop — the
  //    middle cascade comes from the Trade math. Approximation is fine
  //    here; actual min-out is enforced by the caller at unlock time.
  const usdcIn = 5_000_000n; // $5 in 6-dec USDC

  // V3: USDC is token1 (higher address), WETH is token0. price_usdc_per_weth
  // = (sqrtPriceX96 / 2^96)^2 * 10^12 (decimal adjust). Flip for WETH out.
  const sq1 = BigInt(v3SqrtPriceX96);
  const Q96 = 1n << 96n;
  // WETH_out = usdcIn * 2^192 / sqrtPrice^2  (ratio inverts because USDC is token1)
  const wethOut = (usdcIn * Q96 * Q96) / (sq1 * sq1);

  // V4: WORD is token0, WETH is token1. price_weth_per_word = sqrtP^2/2^192.
  // WORD_out = wethIn / price = wethIn * 2^192 / sqrtP^2.
  const sq2 = BigInt(v4Slot0.sqrtPriceX96.toString());
  const wordOut = (wethOut * Q96 * Q96) / (sq2 * sq2);
  log('\nEstimated route amounts:');
  log('  5 USDC →', wethOut.toString(), 'WETH wei (~', Number(wethOut) / 1e18, 'ETH)');
  log('           →', wordOut.toString(), 'WORD wei (~', Number(wordOut) / 1e18, 'WORD)');

  // 3b) Build a PartialClassicQuote representing USDC → WETH (v3) → WORD (v4)
  const quote: PartialClassicQuote = {
    tokenIn: USDC,
    tokenOut: WORD,
    tradeType: TradeType.EXACT_INPUT,
    route: [[
      {
        type: PoolType.V3Pool,
        address: V3_USDC_WETH_005,
        tokenIn: {
          address: USDC, chainId: CHAIN_ID, symbol: 'USDC', decimals: '6',
        },
        tokenOut: {
          address: WETH, chainId: CHAIN_ID, symbol: 'WETH', decimals: '18',
        },
        sqrtRatioX96: v3SqrtPriceX96,
        liquidity: v3Liq.toString(),
        tickCurrent: v3Tick,
        fee: v3Fee.toString(),
        amountIn: usdcIn.toString(),
        amountOut: wethOut.toString(),
      },
      {
        type: PoolType.V4Pool,
        tokenIn: {
          address: WETH, chainId: CHAIN_ID, symbol: 'WETH', decimals: '18',
        },
        tokenOut: {
          address: WORD, chainId: CHAIN_ID, symbol: 'WORD', decimals: '18',
        },
        fee: String(WORD_FEE),
        tickSpacing: String(WORD_TICK_SPACING),
        hooks: WORD_HOOK,
        sqrtRatioX96: v4Slot0.sqrtPriceX96.toString(),
        liquidity: v4Liq.toString(),
        tickCurrent: v4Slot0.tick.toString(),
        amountIn: wethOut.toString(),
        amountOut: wordOut.toString(),
      },
    ]],
  };

  // 4) Let the adapter build a Trade, then ask UR for calldata.
  const trade = RouterTradeAdapter.fromClassicQuote(quote);

  const { calldata } = SwapRouter.swapCallParameters(trade, {
    slippageTolerance: new Percent(500, 10_000), // 5%
    recipient: '0x0000000000000000000000000000000000000001', // placeholder; contract is recipient at call time
    version: UniversalRouterVersion.V2_0,
    deadlineOrPreviousBlockhash: Math.floor(Date.now() / 1000) + 3600,
  });

  // 5) Decode execute(bytes commands, bytes[] inputs, uint256 deadline)
  //    and print commands + inputs in a format easy to paste.
  const iface = new ethers.utils.Interface([
    'function execute(bytes commands, bytes[] inputs, uint256 deadline)',
  ]);
  const parsed = iface.parseTransaction({ data: calldata });
  const commands: string = parsed.args.commands;
  const inputs: string[] = parsed.args.inputs;
  const deadline: string = parsed.args.deadline.toString();

  log('\n=== Universal Router recipe ===\n');
  log('commands:', commands);
  log('inputs   (' + inputs.length + '):');
  for (const i of inputs) log('  ', i);
  log('deadline (sample): ', deadline);

  log('\n=== Paste into contracts/test/GriddlePremiumFork.t.sol ===\n');
  log(`bytes memory commands = hex"${commands.slice(2)}";`);
  log(`bytes[] memory inputs = new bytes[](${inputs.length});`);
  inputs.forEach((inp, idx) => {
    log(`inputs[${idx}] = hex"${inp.slice(2)}";`);
  });

  // 6) Print expected minOut from SDK estimate
  const minOut = trade.minimumAmountOut(new Percent(500, 10_000)).quotient.toString();
  log('\nminWordOut (5% slippage):', minOut, 'wei');

  // JSON mode: emit ONLY a clean JSON object to stdout so the runbook
  // can jq it. All other output went to the muted `log()` fn.
  if (JSON_MODE) {
    const out = { commands, inputs, deadline, minWordOut: minOut };
    process.stdout.write(JSON.stringify(out));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
