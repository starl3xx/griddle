// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test, console2 } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Permit } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";

import { GriddlePremium } from "../src/GriddlePremium.sol";
import { MockOracle } from "./mocks/MockOracle.sol";

/**
 * Fork test against Base mainnet. Proves unlockWithUsdc end-to-end
 * against the real Universal Router, real Permit2, real USDC, and the
 * real Uniswap v4 WORD/WETH Clanker pool.
 *
 * What this test produces, on success:
 *   - Confirms the GriddlePremium contract's USDC permit + Permit2 +
 *     UR + burn sequence is correct against real infrastructure.
 *   - Prints the exact `commands` + `inputs` bytes that should be
 *     passed to `setSwapConfig()` on mainnet immediately after deploy.
 *
 * Prerequisites:
 *   1. Run `script/DiscoverWordPool.s.sol` first and paste the
 *      discovered pool params (hook address, fee, tickSpacing) into
 *      the WORD_HOOK / WORD_FEE / WORD_TICK_SPACING constants below.
 *   2. Set BASE_RPC_URL in your env.
 *
 * Run:
 *
 *   source contracts/.env  # BASE_RPC_URL
 *   forge test \
 *     --match-contract GriddlePremiumForkTest \
 *     --fork-url $BASE_RPC_URL \
 *     -vvv
 */
contract GriddlePremiumForkTest is Test {
    // --- Canonical Base mainnet addresses ---------------------------------
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant WORD = 0x304e649e69979298BD1AEE63e175ADf07885fb4b;
    address constant UNIVERSAL_ROUTER = 0x6fF5693b99212Da76ad316178A184AB56D299b43;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    // --- WORD pool params (FILL FROM DiscoverWordPool.s.sol OUTPUT) -------
    // Placeholders below assume Clanker v4 defaults. The discovery
    // script will emit the real values — paste them here before running.
    address constant WORD_HOOK = 0x0000000000000000000000000000000000000000; // TODO: discover
    uint24  constant WORD_FEE  = 10_000;   // 1% static — common Clanker default
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
        // Two UR commands: V3 USDC→WETH, then V4 WETH→WORD.
        commands = abi.encodePacked(CMD_V3_SWAP_EXACT_IN, CMD_V4_SWAP);
        inputs = new bytes[](2);

        // --- Leg 1: V3 USDC→WETH ----------------------------------------
        // V3_SWAP_EXACT_IN input shape:
        //   (address recipient, uint256 amountIn, uint256 amountOutMin,
        //    bytes path, bool payerIsUser)
        bytes memory v3Path = abi.encodePacked(USDC, USDC_WETH_FEE, WETH);
        inputs[0] = abi.encode(
            UNIVERSAL_ROUTER,  // recipient = UR holds WETH for leg 2
            USDC_5,            // amountIn = $5
            uint256(0),        // amountOutMin — our contract enforces final floor
            v3Path,
            true               // payerIsUser → pull USDC from GriddlePremium via Permit2
        );

        // --- Leg 2: V4 WETH→WORD ---------------------------------------
        // V4_SWAP wraps a sub-action sequence:
        //   - SWAP_EXACT_IN_SINGLE (0x06)
        //   - SETTLE_ALL (0x0c)
        //   - TAKE_ALL (0x0f)
        bytes memory v4Actions = abi.encodePacked(
            bytes1(0x06),
            bytes1(0x0c),
            bytes1(0x0f)
        );

        bytes[] memory v4Params = new bytes[](3);

        // SWAP_EXACT_IN_SINGLE params:
        //   (PoolKey poolKey, bool zeroForOne, uint128 amountIn,
        //    uint128 amountOutMinimum, bytes hookData)
        bool wordIsZero = uint160(WORD) < uint160(WETH);
        v4Params[0] = abi.encode(
            _poolKey(),
            !wordIsZero,        // WETH → WORD: zeroForOne if WETH is token0
            uint128(0),          // amountIn = open — UR has WETH from leg 1, SETTLE_ALL routes it
            uint128(0),          // min amount — our contract enforces final floor
            bytes("")            // no hookData
        );
        // SETTLE_ALL params: (Currency currency, uint256 maxAmount)
        v4Params[1] = abi.encode(WETH, type(uint256).max);
        // TAKE_ALL params: (Currency currency, uint256 minAmount)
        v4Params[2] = abi.encode(WORD, uint256(0));

        inputs[1] = abi.encode(v4Actions, v4Params);
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
