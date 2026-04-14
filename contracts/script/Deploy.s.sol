// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Script, console2 } from "forge-std/Script.sol";
import { WordOracle } from "../src/WordOracle.sol";
import { GriddlePremium } from "../src/GriddlePremium.sol";

/**
 * @notice Deploy WordOracle (adapter) + GriddlePremium to Base mainnet.
 *
 * GriddleRewards (streak payouts) is intentionally NOT deployed.
 *
 * WordOracle is a stateless read-only adapter over the LHAW
 * JackpotManagerV3 market-cap oracle — no oracle updater cron needed,
 * the existing LHAW backend feeds it automatically.
 *
 * Required env vars (set in contracts/.env, then `source .env`):
 *   PRIVATE_KEY              — deployer key; also becomes the initial owner
 *                              unless OWNER is set separately
 *   BASE_RPC_URL             — Base mainnet RPC (Alchemy / Coinbase)
 *   BASESCAN_API_KEY         — for --verify
 *   JACKPOT_MANAGER_ADDRESS  — LHAW JackpotManagerV3 on Base mainnet
 *                              (0xfcb0D07a5BB5B004A1580D5Ae903E33c4A79EdB5)
 *   ESCROW_MANAGER_ADDRESS   — backend EOA that opens fiat escrows
 *                              (0x2097D2C5127DF3f96876A360F4cbDAcfF82b9080)
 *   OWNER (optional)         — Ownable2Step owner; defaults to deployer
 *
 * Usage:
 *   source .env
 *   forge script script/Deploy.s.sol --rpc-url $BASE_RPC_URL --broadcast --verify
 */
contract Deploy is Script {
    address internal constant MAINNET_WORD = 0x304e649e69979298BD1AEE63e175ADf07885fb4b;

    function run() external {
        uint256 deployerPk    = vm.envUint("PRIVATE_KEY");
        address jackpotMgr    = vm.envOr("JACKPOT_MANAGER_ADDRESS",
                                    0xfcb0D07a5BB5B004A1580D5Ae903E33c4A79EdB5);
        address escrowManager = vm.envAddress("ESCROW_MANAGER_ADDRESS");
        address owner         = vm.envOr("OWNER", vm.addr(deployerPk));

        vm.startBroadcast(deployerPk);

        // 1. Deploy stateless oracle adapter (reads LHAW JackpotManagerV3).
        WordOracle oracle = new WordOracle(jackpotMgr);

        // 2. Deploy GriddlePremium with the oracle adapter address.
        GriddlePremium premium = new GriddlePremium(
            MAINNET_WORD,
            address(oracle),
            escrowManager,
            owner
        );

        vm.stopBroadcast();

        console2.log("WordOracle deployed at:    ", address(oracle));
        console2.log("GriddlePremium deployed at:", address(premium));
        console2.log("Owner:                     ", owner);
        console2.log("Escrow manager:            ", escrowManager);
        console2.log("JackpotManager (upstream): ", jackpotMgr);
        console2.log("");
        console2.log("=== Copy these into Vercel env vars ===");
        console2.log("NEXT_PUBLIC_GRIDDLE_PREMIUM_ADDRESS=", address(premium));
        console2.log("ORACLE_ADDRESS=", address(oracle));
    }
}
