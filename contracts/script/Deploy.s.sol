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
 * Base mainnet pinned addresses (overridable via env for testnets / forks):
 *   USDC                 — 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 (native USDC)
 *   UNIVERSAL_ROUTER     — 0x6fF5693b99212Da76ad316178A184AB56D299b43
 *   PERMIT2              — 0x000000000022D473030F116dDEE9F6B43aC78BA3
 *
 * After deploy, call `setSwapConfig(commands, inputs)` from the owner
 * with the USDC → WETH → $WORD Universal Router recipe. Until that's
 * set, `unlockWithUsdc` reverts with `SwapConfigNotSet`.
 *
 * Usage:
 *   source .env
 *   forge script script/Deploy.s.sol --rpc-url $BASE_RPC_URL --broadcast --verify
 */
contract Deploy is Script {
    address internal constant MAINNET_WORD             = 0x304e649e69979298BD1AEE63e175ADf07885fb4b;
    address internal constant MAINNET_USDC             = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address internal constant MAINNET_UNIVERSAL_ROUTER = 0x6fF5693b99212Da76ad316178A184AB56D299b43;
    address internal constant MAINNET_PERMIT2          = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    function run() external {
        uint256 deployerPk    = vm.envUint("PRIVATE_KEY");
        address jackpotMgr    = vm.envOr("JACKPOT_MANAGER_ADDRESS",
                                    0xfcb0D07a5BB5B004A1580D5Ae903E33c4A79EdB5);
        address escrowManager = vm.envAddress("ESCROW_MANAGER_ADDRESS");
        address owner         = vm.envOr("OWNER", vm.addr(deployerPk));
        address usdc          = vm.envOr("USDC_ADDRESS", MAINNET_USDC);
        address router        = vm.envOr("UNIVERSAL_ROUTER_ADDRESS", MAINNET_UNIVERSAL_ROUTER);
        address permit2       = vm.envOr("PERMIT2_ADDRESS", MAINNET_PERMIT2);

        vm.startBroadcast(deployerPk);

        // 1. Deploy stateless oracle adapter (reads LHAW JackpotManagerV3).
        WordOracle oracle = new WordOracle(jackpotMgr);

        // 2. Deploy GriddlePremium with the oracle adapter + swap venue addresses.
        GriddlePremium premium = new GriddlePremium(
            MAINNET_WORD,
            usdc,
            router,
            permit2,
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
        console2.log("USDC:                      ", usdc);
        console2.log("Universal Router:          ", router);
        console2.log("Permit2:                   ", permit2);
        console2.log("");
        console2.log("=== Copy these into Vercel env vars ===");
        console2.log("NEXT_PUBLIC_GRIDDLE_PREMIUM_ADDRESS=", address(premium));
        console2.log("NEXT_PUBLIC_USDC_ADDRESS=           ", usdc);
        console2.log("ORACLE_ADDRESS=                     ", address(oracle));
        console2.log("");
        console2.log("Next steps:");
        console2.log(" 1. Owner calls setSwapConfig(commands, inputs) for USDC -> WETH -> WORD.");
        console2.log(" 2. Escrow manager EOA calls WORD.approve(GriddlePremium, max).");
    }
}
