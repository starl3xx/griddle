// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test, console2 } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Permit } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";

import { GriddlePremium } from "../src/GriddlePremium.sol";
import { MockOracle } from "./mocks/MockOracle.sol";

/**
 * Fork test against Base mainnet. Exercises unlockWithUsdc end-to-end
 * against the real Universal Router, real Permit2, real USDC, and the
 * real Uniswap v4 WORD/WETH Clanker pool.
 *
 * ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
 * ┃  STATUS: INCOMPLETE — ends in Clanker hook revert             ┃
 * ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
 *
 * The test walks the full permit + Permit2 + V3-leg path cleanly.
 * The V4 leg (WETH → $WORD via the Clanker pool) reverts inside the
 * hook with `NotPoolManager()` (selector 0xd81b2f2e). Trace shows
 * Clanker's MEV-module path:
 *
 *   beforeSwap → collectRewardsWithoutUnlock → beforeSwap
 *                → simulateSwap → REVERT
 *
 * This is NOT a bug in GriddlePremium — the contract's USDC pull,
 * Permit2 allowance dance, and UR invocation are all correct. The
 * barrier is Clanker's ClankerSniperAuctionV0 expecting a specific
 * authorized-router calldata shape that plain UR V4_SWAP doesn't
 * match by default.
 *
 * Forward path: DON'T hand-encode the V4 calldata. Instead use
 * Uniswap's universal-router-sdk (npm package) to compute the swap
 * recipe off-chain for a $5 USDC → $WORD trade. The SDK understands
 * Clanker hooks + MEV modules and picks the correct route. Run it
 * once per deploy, paste the resulting `commands` + `inputs` bytes
 * into `setSwapConfig()` on the production contract.
 *
 * What this test is still useful for:
 *   - Verifying GriddlePremium's USDC permit / Permit2 / UR call
 *     sequence works against real infrastructure (up to the V4 hook
 *     revert, everything passes).
 *   - Producing the V3 leg's encoded bytes in case you want a
 *     V3-only fallback route (e.g., if liquidity migrates).
 *
 * Prerequisites:
 *   1. Pool params already discovered via DiscoverWordPool.s.sol
 *      (Initialize event on Base v4 PoolManager):
 *        WORD_HOOK           = 0xd60D6B218116cFd801E28F78d011a203D2b068Cc
 *        WORD_FEE            = 0x800000 (DYNAMIC_FEE_FLAG)
 *        WORD_TICK_SPACING   = 200
 *   2. Set BASE_RPC_URL in your env.
 *
 * Run:
 *
 *   source contracts/.env  # BASE_RPC_URL
 *   forge test \
 *     --match-contract GriddlePremiumForkTest \
 *     --fork-url $BASE_RPC_URL \
 *     --evm-version cancun \
 *     -vvvv
 */
contract GriddlePremiumForkTest is Test {
    // --- Canonical Base mainnet addresses ---------------------------------
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant WORD = 0x304e649e69979298BD1AEE63e175ADf07885fb4b;
    address constant UNIVERSAL_ROUTER = 0x6fF5693b99212Da76ad316178A184AB56D299b43;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    // --- WORD pool params (discovered via Uniswap v4 PoolManager log scan)
    // Initialize(PoolId=0xc5db937916d2c6f96142a6886ba8b5b74e14949c9cc1080a676ab2a5eb1ea275)
    // at block 42157034 on Base mainnet, currency0=WORD, currency1=WETH.
    address constant WORD_HOOK = 0xd60D6B218116cFd801E28F78d011a203D2b068Cc;
    uint24  constant WORD_FEE  = 0x800000; // DYNAMIC_FEE_FLAG — Clanker hook sets the fee at swap time
    int24   constant WORD_TICK_SPACING = 200;

    // --- V3 leg (USDC → WETH) ---------------------------------------------
    // Base v3 USDC/WETH has deepest liquidity at the 0.05% tier.
    uint24 constant USDC_WETH_FEE = 500;

    // --- Universal Router command bytes -----------------------------------
    // See @uniswap/universal-router/contracts/libraries/Commands.sol
    bytes1 constant CMD_V3_SWAP_EXACT_IN = 0x00;
    bytes1 constant CMD_V4_SWAP          = 0x10;

    // --- Test scaffolding -------------------------------------------------
    GriddlePremium internal premium;
    MockOracle internal oracle;
    address internal owner         = makeAddr("owner");
    address internal escrowManager = makeAddr("escrowManager");

    uint256 internal playerPk;
    address internal player;

    // Oracle price: $0.0001/$WORD → expected = 50,000 $WORD for $5.
    uint256 internal constant PRICE = 1e14;
    uint256 internal constant EXPECTED = 50_000e18;
    uint256 internal constant USDC_5 = 5_000_000;

    function setUp() public {
        vm.createSelectFork(vm.envString("BASE_RPC_URL"));

        oracle = new MockOracle(PRICE);

        premium = new GriddlePremium(
            WORD,
            USDC,
            UNIVERSAL_ROUTER,
            PERMIT2,
            address(oracle),
            escrowManager,
            owner
        );

        playerPk = 0xA11CE;
        player = vm.addr(playerPk);

        // Fund the player with $10 USDC by writing balance storage
        // directly. forge-std's `deal` handles the ERC20 balance slot
        // lookup for native USDC correctly.
        deal(USDC, player, 10 * 1e6);

        // Build + commit the swap recipe. We do this from the owner
        // per the contract's access control.
        (bytes memory commands, bytes[] memory inputs) = _buildSwapRecipe();
        vm.prank(owner);
        premium.setSwapConfig(commands, inputs);
    }

    // --- Recipe encoding --------------------------------------------------

    function _buildSwapRecipe()
        internal
        pure
        returns (bytes memory commands, bytes[] memory inputs)
    {
        // Generated by scripts/swap-recipe/compute-recipe.ts using
        // Uniswap's universal-router-sdk. Computed for a $5 USDC →
        // $WORD swap via V3 USDC/WETH 0.05% → V4 WETH/WORD Clanker
        // pool, with recipient routing that satisfies Clanker's
        // MEV-hook calldata expectations (which plain hand-encoded
        // V4_SWAP does not). Re-run the TS script to regenerate if
        // pool state or router version changes.
        commands = hex"0010";
        inputs = new bytes[](2);

        // V3_SWAP_EXACT_IN: USDC → WETH at 0.05% fee tier
        inputs[0] = hex"000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000004c4b40000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002b833589fcd6edb6e08f4c7c32d4f71b54bda029130001f44200000000000000000000000000000000000006000000000000000000000000000000000000000000";

        // V4_SWAP: WETH → WORD on Clanker v4 pool (actions: SETTLE +
        // SWAP_EXACT_IN + TAKE).
        inputs[1] = hex"0000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000030b070e00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000002a0000000000000000000000000000000000000000000000000000000000000006000000000000000000000000042000000000000000000000000000000000000068000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000004200000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000b0c624d289a47e295b86700000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000304e649e69979298bd1aee63e175adf07885fb4b000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000000000c8000000000000000000000000d60d6b218116cfd801e28f78d011a203d2b068cc00000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000060000000000000000000000000304e649e69979298bd1aee63e175adf07885fb4b00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000";
    }

    function _poolKey() internal pure returns (PoolKey memory) {
        address c0;
        address c1;
        if (uint160(WORD) < uint160(WETH)) {
            c0 = WORD;
            c1 = WETH;
        } else {
            c0 = WETH;
            c1 = WORD;
        }
        return PoolKey({
            currency0: c0,
            currency1: c1,
            fee: WORD_FEE,
            tickSpacing: WORD_TICK_SPACING,
            hooks: WORD_HOOK
        });
    }

    // --- Tests ------------------------------------------------------------

    function test_unlockWithUsdc_forkedMainnet() public {
        require(WORD_HOOK != address(0), "WORD_HOOK placeholder - run DiscoverWordPool.s.sol first");

        uint256 minWordOut = (EXPECTED * 95) / 100;

        (uint256 deadline, uint8 v, bytes32 r, bytes32 s) =
            _signUsdcPermit(playerPk, address(premium), USDC_5);

        uint256 wordSupplyBefore = IERC20(WORD).totalSupply();
        uint256 playerUsdcBefore = IERC20(USDC).balanceOf(player);

        vm.prank(player);
        premium.unlockWithUsdc(deadline, v, r, s, minWordOut);

        // Premium flipped.
        assertTrue(premium.isPremium(player), "premium not set");

        // USDC pulled.
        assertEq(
            IERC20(USDC).balanceOf(player),
            playerUsdcBefore - USDC_5,
            "USDC not pulled"
        );

        // WORD burned (totalSupply decreased).
        uint256 supplyAfter = IERC20(WORD).totalSupply();
        assertLt(supplyAfter, wordSupplyBefore, "WORD totalSupply didn't drop");

        // Contract holds no leftover WORD or USDC.
        assertEq(IERC20(WORD).balanceOf(address(premium)), 0, "WORD dust remained");
        assertEq(IERC20(USDC).balanceOf(address(premium)), 0, "USDC dust remained");

        // Print the recipe so you can copy it into setSwapConfig on mainnet.
        (bytes memory commands, bytes[] memory inputs) = _buildSwapRecipe();
        console2.log("");
        console2.log("=== setSwapConfig recipe (copy to mainnet deploy) ===");
        console2.log("commands:");
        console2.logBytes(commands);
        for (uint256 i = 0; i < inputs.length; i++) {
            console2.log("input[%s]:", i);
            console2.logBytes(inputs[i]);
        }
    }

    // --- Helpers ----------------------------------------------------------

    function _signUsdcPermit(uint256 pk, address spender, uint256 amount)
        internal
        view
        returns (uint256 deadline, uint8 v, bytes32 r, bytes32 s)
    {
        address ownerAddr = vm.addr(pk);
        deadline = block.timestamp + 1 hours;
        bytes32 PERMIT_TYPEHASH = keccak256(
            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
        );
        bytes32 structHash = keccak256(
            abi.encode(
                PERMIT_TYPEHASH,
                ownerAddr,
                spender,
                amount,
                IERC20Permit(USDC).nonces(ownerAddr),
                deadline
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", IERC20Permit(USDC).DOMAIN_SEPARATOR(), structHash)
        );
        (v, r, s) = vm.sign(pk, digest);
    }
}

/// Minimal V4 `PoolKey` mirror (bits of v4-core we need for the
/// SWAP_EXACT_IN_SINGLE params). Kept local so the repo doesn't take
/// a new Uniswap v4 dependency for this one test.
struct PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

/// Mirror of v4-periphery's ExactInputSingleParams for ABI-clean
/// encoding of the SWAP_EXACT_IN_SINGLE action.
struct ExactInputSingleParams {
    PoolKey poolKey;
    bool zeroForOne;
    uint128 amountIn;
    uint128 amountOutMinimum;
    bytes hookData;
}
