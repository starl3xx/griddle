// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Script, console2 } from "forge-std/Script.sol";
import { GriddlePremium } from "../src/GriddlePremium.sol";
import { GriddleRewards } from "../src/GriddleRewards.sol";

/**
 * @notice Deploy GriddlePremium + GriddleRewards to Base mainnet.
 *
 * Required env vars:
 *   PRIVATE_KEY              — deployer key (will also be the initial owner
 *                              unless OWNER is set)
 *   WORD_ADDRESS             — mainnet default 0x304e...fb4b
 *   ORACLE_ADDRESS           — LHAW oracle extended with getWordUsdPrice()
 *   ESCROW_MANAGER_ADDRESS   — backend EOA permitted to open fiat escrows
 *   REWARD_SIGNER_ADDRESS    — address whose signatures back streak claim vouchers
 *   OWNER (optional)         — Ownable2Step owner, defaults to deployer
 *
 * Usage:
 *   forge script script/Deploy.s.sol --rpc-url base --broadcast --verify
 */
contract Deploy is Script {
    // Hardcoded mainnet $WORD — used as a safety check against the env var.
    address internal constant MAINNET_WORD = 0x304e649e69979298BD1AEE63e175ADf07885fb4b;

    function run() external {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address word = vm.envOr("WORD_ADDRESS", MAINNET_WORD);
        address oracle = vm.envAddress("ORACLE_ADDRESS");
        address escrowManager = vm.envAddress("ESCROW_MANAGER_ADDRESS");
        address rewardSigner = vm.envAddress("REWARD_SIGNER_ADDRESS");
        address owner = vm.envOr("OWNER", vm.addr(deployerPk));

        if (block.chainid == 8453 && word != MAINNET_WORD) {
            revert("Refusing to deploy on Base with non-canonical $WORD address");
        }

        vm.startBroadcast(deployerPk);

        GriddlePremium premium = new GriddlePremium(word, oracle, escrowManager, owner);
        GriddleRewards rewards = new GriddleRewards(word, rewardSigner, owner);

        vm.stopBroadcast();

        console2.log("GriddlePremium deployed at:", address(premium));
        console2.log("GriddleRewards deployed at:", address(rewards));
        console2.log("Owner:                     ", owner);
        console2.log("Oracle:                    ", oracle);
        console2.log("Escrow manager:            ", escrowManager);
        console2.log("Reward signer:             ", rewardSigner);
    }
}
