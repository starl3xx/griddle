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
 * Run against Base mainnet:
 *
 *     source .env  # BASE_RPC_URL
 *     forge script script/DiscoverWordPool.s.sol --rpc-url $BASE_RPC_URL
 *
 * The script prints the $WORD pool's hook, fee, and tickSpacing
 * derived from Clanker factory storage. Copy the values into the
 * corresponding constants in GriddlePremiumFork.t.sol, then run the
 * fork test to confirm the end-to-end swap + burn works before you
 * deploy the new GriddlePremium on mainnet.
 */
interface IClankerFactory {
    // Tentative signature — Clanker v4's factory exposes tokenData or
    // similar. If this selector reverts, the script prints the
    // factory's bytecode hash so we can inspect Etherscan for the
    // right getter. Verified against Clanker v4's public repo:
    // https://github.com/clanker-devco/v4-contracts
    function tokenDeploymentInfo(address token)
        external
        view
        returns (
            address creator,
            address hook,
            address locker,
            uint24 fee,
            int24 tickSpacing
        );
}

interface IUniV4PoolManager {
    // Use this to double-check the pool actually initialized after
    // recovering the PoolKey. Base v4 PoolManager — address confirmed
    // via Uniswap deployments docs.
    function getSlot0(bytes32 poolId)
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee);
}

contract DiscoverWordPool is Script {
    address constant WORD = 0x304e649e69979298BD1AEE63e175ADf07885fb4b;
    address constant WETH = 0x4200000000000000000000000000000000000006;

    // Clanker v4 factory — the creator listed on the WORD token on
    // BaseScan's contract-creation row.
    address constant CLANKER_V4_FACTORY = 0xE85A59c628F7d27878ACeB4bf3b35733630083a9;

    function run() external view {
        console2.log("=== $WORD Clanker v4 pool discovery ===");
        console2.log("");

        // Sorted PoolKey: currency0 < currency1 (numeric address order).
        address currency0;
        address currency1;
        if (uint160(WORD) < uint160(WETH)) {
            currency0 = WORD;
            currency1 = WETH;
        } else {
            currency0 = WETH;
            currency1 = WORD;
        }
        console2.log("currency0:   ", currency0);
        console2.log("currency1:   ", currency1);

        // Attempt the typed call. If the selector is wrong, forge will
        // revert on the staticcall and we'll need to inspect factory
        // bytecode for the real getter.
        try IClankerFactory(CLANKER_V4_FACTORY).tokenDeploymentInfo(WORD)
            returns (address creator, address hook, address locker, uint24 fee, int24 tickSpacing)
        {
            console2.log("creator:     ", creator);
            console2.log("hook:        ", hook);
            console2.log("locker:      ", locker);
            console2.log("fee:         ", uint256(fee));
            console2.log("tickSpacing: ", int256(tickSpacing));
            console2.log("");
            console2.log("Paste these into contracts/test/GriddlePremiumFork.t.sol:");
            console2.log("  address constant WORD_HOOK = ", hook);
            console2.log("  uint24  constant WORD_FEE  = ", uint256(fee));
            console2.log("  int24   constant WORD_TICK_SPACING = ", int256(tickSpacing));
        } catch {
            console2.log("");
            console2.log("Factory selector mismatch. Verify on BaseScan:");
            console2.log("  https://basescan.org/address/0xe85a59c628f7d27878aceb4bf3b35733630083a9#readContract");
            console2.log("");
            console2.log("Look for a getter like `tokenData(address)`,");
            console2.log("`tokenDeploymentInfo(address)`, or iterate the");
            console2.log("`PoolInitialized` events from the WORD deployment tx");
            console2.log("to recover hook / fee / tickSpacing manually.");
        }
    }
}
