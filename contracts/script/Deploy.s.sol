// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Script, console2 } from "forge-std/Script.sol";
import { WordOracle } from "../src/WordOracle.sol";
import { GriddlePremium } from "../src/GriddlePremium.sol";
import { GriddleRewards } from "../src/GriddleRewards.sol";

/**
 * @notice Deploy WordOracle + GriddlePremium + GriddleRewards to Base mainnet.
 *
 * Required env vars (set in contracts/.env, then `source .env`):
 *   PRIVATE_KEY              — deployer key; also becomes the initial owner
 *                              unless OWNER is set separately
 *   BASE_RPC_URL             — Base mainnet RPC (Alchemy / Coinbase)
 *   BASESCAN_API_KEY         — for --verify
 *   ESCROW_MANAGER_ADDRESS   — backend EOA that opens fiat escrows
 *                              (0x2097D2C5127DF3f96876A360F4cbDAcfF82b9080)
 *   ORACLE_UPDATER_ADDRESS   — backend EOA that pushes $WORD/USD price
 *                              (can be the same as ESCROW_MANAGER_ADDRESS)
 *   REWARD_SIGNER_ADDRESS    — backend EOA that signs streak reward vouchers
 *   OWNER (optional)         — Ownable2Step owner; defaults to deployer
 *
 * Usage:
 *   source .env
 *   forge script script/Deploy.s.sol --rpc-url $BASE_RPC_URL --broadcast --verify
 */
contract Deploy is Script {
    address internal constant MAINNET_WORD = 0x304e649e69979298BD1AEE63e175ADf07885fb4b;

    function run() external {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address escrowManager = vm.envAddress("ESCROW_MANAGER_ADDRESS");
        address oracleUpdater = vm.envAddress("ORACLE_UPDATER_ADDRESS");
        address rewardSigner = vm.envAddress("REWARD_SIGNER_ADDRESS");
        address owner = vm.envOr("OWNER", vm.addr(deployerPk));

        vm.startBroadcast(deployerPk);

        // 1. Deploy oracle first — GriddlePremium needs its address.
        WordOracle oracle = new WordOracle(oracleUpdater, owner);

        // 2. Deploy GriddlePremium with the fresh oracle address.
        GriddlePremium premium = new GriddlePremium(
            MAINNET_WORD,
            address(oracle),
            escrowManager,
            owner
        );

        // 3. Deploy GriddleRewards.
        GriddleRewards rewards = new GriddleRewards(MAINNET_WORD, rewardSigner, owner);

        vm.stopBroadcast();

        console2.log("WordOracle deployed at:    ", address(oracle));
        console2.log("GriddlePremium deployed at:", address(premium));
        console2.log("GriddleRewards deployed at:", address(rewards));
        console2.log("Owner:                     ", owner);
        console2.log("Oracle updater:            ", oracleUpdater);
        console2.log("Escrow manager:            ", escrowManager);
        console2.log("Reward signer:             ", rewardSigner);
        console2.log("");
        console2.log("=== Copy these into Vercel env vars ===");
        console2.log("NEXT_PUBLIC_GRIDDLE_PREMIUM_ADDRESS=", address(premium));
        console2.log("NEXT_PUBLIC_GRIDDLE_REWARDS_ADDRESS=", address(rewards));
        console2.log("ORACLE_ADDRESS=", address(oracle));
    }
}
