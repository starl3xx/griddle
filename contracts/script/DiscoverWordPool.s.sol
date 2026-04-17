// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Script, console2 } from "forge-std/Script.sol";

/**
 * @notice One-shot discovery script for the $WORD Clanker v4 pool
 *         parameters. Needed because Clanker deploys a unique hook
 *         contract per token, and the PoolKey (currency0, currency1,
 *         fee, tickSpacing, hooks) is not derivable from the token
 *         address alone.
 *
 * Two-stage discovery:
 *   1. Ask Clanker's factory for $WORD's hook address via
 *      `tokenDeploymentInfo(address)` → `DeploymentInfo`.
 *   2. Brute-force common (fee, tickSpacing) pairs against the known
 *      PoolId reported by DexScreener until the PoolKey hash matches,
 *      yielding the exact Uniswap v4 pool parameters.
 *
 * Run:
 *     source .env  # BASE_RPC_URL
 *     forge script script/DiscoverWordPool.s.sol --rpc-url $BASE_RPC_URL
 *
 * The script prints the matching hook / fee / tickSpacing for
 * GriddlePremiumFork.t.sol.
 */
interface IClankerFactory {
    struct DeploymentInfo {
        address token;
        address hook;
        address locker;
        address[] extensions;
    }

    function tokenDeploymentInfo(address token)
        external
        view
        returns (DeploymentInfo memory);
}

struct PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

contract DiscoverWordPool is Script {
    address constant WORD = 0x304e649e69979298BD1AEE63e175ADf07885fb4b;
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant CLANKER_V4_FACTORY = 0xE85A59c628F7d27878ACeB4bf3b35733630083a9;

    // Known PoolId from DexScreener's listing for the WORD/WETH v4 pool.
    bytes32 constant KNOWN_POOL_ID = 0xc5db937916d2c6f96142a6886ba8b5b74e14949c9cc1080a676ab2a5eb1ea275;

    // Uniswap v4 hook permission bitmask flag for dynamic fees
    // (ClankerHookDynamicFee sets this).
    uint24 constant DYNAMIC_FEE_FLAG = 0x800000;

    function run() external view {
        console2.log("=== $WORD Clanker v4 pool discovery ===");

        address c0 = uint160(WORD) < uint160(WETH) ? WORD : WETH;
        address c1 = uint160(WORD) < uint160(WETH) ? WETH : WORD;
        console2.log("currency0: ", c0);
        console2.log("currency1: ", c1);

        // --- Stage 1: ask factory for hook ---------------------------
        address hook;
        try IClankerFactory(CLANKER_V4_FACTORY).tokenDeploymentInfo(WORD)
            returns (IClankerFactory.DeploymentInfo memory info)
        {
            hook = info.hook;
            console2.log("token (echo):        ", info.token);
            console2.log("hook (from factory): ", hook);
            console2.log("locker:              ", info.locker);
        } catch {
            console2.log("");
            console2.log("Could not call tokenDeploymentInfo. Check factory on BaseScan:");
            console2.log("  https://basescan.org/address/0xe85a59c628f7d27878aceb4bf3b35733630083a9#readContract");
            return;
        }

        // --- Stage 2: brute-force fee + tickSpacing --------------------
        // Clanker v4 defaults observed across launches are below. The
        // dynamic-fee hook sets fee = DYNAMIC_FEE_FLAG (0x800000) and
        // usually tickSpacing = 200. The static-fee hook uses a normal
        // fee tier (10000 = 1%) and a corresponding spacing.
        uint24[10] memory feeTiers = [
            uint24(DYNAMIC_FEE_FLAG),  // dynamic, common Clanker default
            uint24(10000),              // 1% static
            uint24(3000),               // 0.3%
            uint24(500),                // 0.05%
            uint24(100),                // 0.01%
            uint24(0),                  // 0 (hook-collected only)
            DYNAMIC_FEE_FLAG | 10000,
            DYNAMIC_FEE_FLAG | 3000,
            DYNAMIC_FEE_FLAG | 500,
            DYNAMIC_FEE_FLAG | 100
        ];
        int24[5] memory tickSpacings = [
            int24(200),
            int24(60),
            int24(10),
            int24(1),
            int24(2)
        ];

        for (uint256 i; i < feeTiers.length; i++) {
            for (uint256 j; j < tickSpacings.length; j++) {
                PoolKey memory k = PoolKey({
                    currency0: c0,
                    currency1: c1,
                    fee: feeTiers[i],
                    tickSpacing: tickSpacings[j],
                    hooks: hook
                });
                bytes32 id = _toId(k);
                if (id == KNOWN_POOL_ID) {
                    console2.log("");
                    console2.log("*** MATCH ***");
                    console2.log("fee:         ", uint256(feeTiers[i]));
                    console2.log("tickSpacing: ", int256(tickSpacings[j]));
                    console2.log("");
                    console2.log("Paste into contracts/test/GriddlePremiumFork.t.sol:");
                    console2.log("  address constant WORD_HOOK = ", hook);
                    console2.log("  uint24  constant WORD_FEE  = ", uint256(feeTiers[i]));
                    console2.log("  int24   constant WORD_TICK_SPACING = ", int256(tickSpacings[j]));
                    return;
                }
            }
        }

        console2.log("");
        console2.log("No fee/tickSpacing combo in the brute-force table matched.");
        console2.log("Expand the tables or query the PoolInitialized event directly.");
        console2.log("Hook we have: ", hook);
        console2.log("Target PoolId: ");
        console2.logBytes32(KNOWN_POOL_ID);
    }

    // Uniswap v4 poolId derivation — keccak256(abi.encode(PoolKey)).
    function _toId(PoolKey memory key) internal pure returns (bytes32) {
        return keccak256(abi.encode(key));
    }
}
