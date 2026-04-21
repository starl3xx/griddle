// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { PushedWordOracle } from "../src/PushedWordOracle.sol";

contract PushedWordOracleTest is Test {
    PushedWordOracle internal oracle;

    address internal updater = makeAddr("updater");
    address internal stranger = makeAddr("stranger");

    event PriceUpdated(uint256 price, uint256 timestamp);

    function setUp() public {
        oracle = new PushedWordOracle(updater);
    }

    // ---- Constructor ----------------------------------------------------

    function test_constructor_revertsOnZeroUpdater() public {
        vm.expectRevert(PushedWordOracle.ZeroAddress.selector);
        new PushedWordOracle(address(0));
    }

    function test_constructor_storesUpdater() public view {
        assertEq(oracle.updater(), updater);
    }

    function test_constructor_initialPriceIsZero() public view {
        (uint256 p, uint256 t) = oracle.getWordUsdPrice();
        assertEq(p, 0);
        assertEq(t, 0);
    }

    // ---- setPrice access control ---------------------------------------

    function test_setPrice_revertsWhenCallerIsNotUpdater() public {
        vm.expectRevert(PushedWordOracle.NotUpdater.selector);
        vm.prank(stranger);
        oracle.setPrice(1e18);
    }

    function test_setPrice_revertsOnZeroPrice() public {
        vm.expectRevert(PushedWordOracle.ZeroPrice.selector);
        vm.prank(updater);
        oracle.setPrice(0);
    }

    // ---- setPrice happy path -------------------------------------------

    function test_setPrice_storesPriceAndTimestamp() public {
        vm.warp(1_700_000_000);
        vm.prank(updater);
        oracle.setPrice(1.23e14);

        (uint256 p, uint256 t) = oracle.getWordUsdPrice();
        assertEq(p, 1.23e14);
        assertEq(t, 1_700_000_000);
    }

    function test_setPrice_emitsPriceUpdatedEvent() public {
        vm.warp(1_800_000_000);
        vm.expectEmit(true, true, true, true);
        emit PriceUpdated(4.56e14, 1_800_000_000);
        vm.prank(updater);
        oracle.setPrice(4.56e14);
    }

    function test_setPrice_overwritesPriorValue() public {
        vm.warp(1_700_000_000);
        vm.prank(updater);
        oracle.setPrice(1e14);

        vm.warp(1_700_000_120); // 2 minutes later
        vm.prank(updater);
        oracle.setPrice(2e14);

        (uint256 p, uint256 t) = oracle.getWordUsdPrice();
        assertEq(p, 2e14);
        assertEq(t, 1_700_000_120);
    }

    // ---- Fuzz ----------------------------------------------------------

    function testFuzz_setPrice_roundtrips(uint256 newPrice, uint256 warpTo) public {
        vm.assume(newPrice != 0);
        // Foundry's default warp range is fine; constrain to avoid overflow
        // in downstream assertions if warpTo is tested against now().
        warpTo = bound(warpTo, 1, type(uint64).max);
        vm.warp(warpTo);

        vm.prank(updater);
        oracle.setPrice(newPrice);

        (uint256 p, uint256 t) = oracle.getWordUsdPrice();
        assertEq(p, newPrice);
        assertEq(t, warpTo);
    }
}
