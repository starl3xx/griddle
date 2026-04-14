// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { GriddlePremium } from "../src/GriddlePremium.sol";
import { IWordToken } from "../src/interfaces/IWordToken.sol";
import { MockWord } from "./mocks/MockWord.sol";
import { MockOracle } from "./mocks/MockOracle.sol";

contract GriddlePremiumTest is Test {
    GriddlePremium internal premium;
    MockWord internal word;
    MockOracle internal oracle;

    address internal owner = makeAddr("owner");
    address internal escrowManager = makeAddr("escrowManager");
    address internal treasury = makeAddr("treasury");
    address internal stranger = makeAddr("stranger");

    uint256 internal playerPk;
    address internal player;

    // Oracle price: $0.0001 per $WORD → to hit $5 you need 50,000 $WORD.
    uint256 internal constant PRICE = 1e14;
    uint256 internal constant EXPECTED_AMOUNT = 50_000e18;

    function setUp() public {
        playerPk = 0xA11CE;
        player = vm.addr(playerPk);

        word = new MockWord();
        oracle = new MockOracle(PRICE);
        premium = new GriddlePremium(address(word), address(oracle), escrowManager, owner);

        word.mint(player, 1_000_000e18);
        word.mint(escrowManager, 1_000_000e18);

        vm.prank(escrowManager);
        word.approve(address(premium), type(uint256).max);
    }

    // --- Crypto path: unlockWithPermit ------------------------------------

    function test_unlockWithPermit_happyPath() public {
        (uint256 deadline, uint8 v, bytes32 r, bytes32 s) = _signPermit(
            playerPk, address(premium), EXPECTED_AMOUNT
        );

        uint256 supplyBefore = word.totalSupply();
        uint256 playerBefore = word.balanceOf(player);

        vm.prank(player);
        premium.unlockWithPermit(EXPECTED_AMOUNT, deadline, v, r, s);

        assertTrue(premium.isPremium(player), "premium flag not set");
        assertEq(word.totalSupply(), supplyBefore - EXPECTED_AMOUNT, "supply not burned");
        assertEq(word.balanceOf(player), playerBefore - EXPECTED_AMOUNT, "balance not debited");
    }

    function test_unlockWithPermit_staleOracleReverts() public {
        // Warp past MAX_ORACLE_AGE (5 min) without touching oracle updatedAt.
        vm.warp(block.timestamp + 10 minutes);

        (uint256 deadline, uint8 v, bytes32 r, bytes32 s) = _signPermit(
            playerPk, address(premium), EXPECTED_AMOUNT
        );

        vm.expectRevert(GriddlePremium.StaleOraclePrice.selector);
        vm.prank(player);
        premium.unlockWithPermit(EXPECTED_AMOUNT, deadline, v, r, s);
    }

    function test_unlockWithPermit_zeroPriceReverts() public {
        oracle.setPrice(0);
        (uint256 deadline, uint8 v, bytes32 r, bytes32 s) = _signPermit(
            playerPk, address(premium), EXPECTED_AMOUNT
        );

        vm.expectRevert(GriddlePremium.OracleZeroPrice.selector);
        vm.prank(player);
        premium.unlockWithPermit(EXPECTED_AMOUNT, deadline, v, r, s);
    }

    function test_unlockWithPermit_amountTooLowReverts() public {
        // min = expected * 0.85 = 42,500e18. Use 40,000e18 to be below.
        uint256 badAmount = 40_000e18;
        (uint256 deadline, uint8 v, bytes32 r, bytes32 s) =
            _signPermit(playerPk, address(premium), badAmount);

        vm.expectRevert(GriddlePremium.TokenAmountOutOfBand.selector);
        vm.prank(player);
        premium.unlockWithPermit(badAmount, deadline, v, r, s);
    }

    function test_unlockWithPermit_amountTooHighReverts() public {
        // max = expected * 1.15 = 57,500e18. Use 60,000e18 to be above.
        uint256 badAmount = 60_000e18;
        (uint256 deadline, uint8 v, bytes32 r, bytes32 s) =
            _signPermit(playerPk, address(premium), badAmount);

        vm.expectRevert(GriddlePremium.TokenAmountOutOfBand.selector);
        vm.prank(player);
        premium.unlockWithPermit(badAmount, deadline, v, r, s);
    }

    function test_unlockWithPermit_withinSlippageBand() public {
        // min = 42_500e18; test at exactly min.
        uint256 minAmount = 42_500e18;
        (uint256 deadline, uint8 v, bytes32 r, bytes32 s) =
            _signPermit(playerPk, address(premium), minAmount);

        vm.prank(player);
        premium.unlockWithPermit(minAmount, deadline, v, r, s);
        assertTrue(premium.isPremium(player));
    }

    // --- Fiat path: unlockForUser + burnEscrowed --------------------------

    function test_unlockForUser_happyPath() public {
        bytes32 externalId = keccak256("stripe_session_1");
        uint256 amount = 60_000e18;

        vm.prank(escrowManager);
        premium.unlockForUser(player, amount, externalId);

        assertTrue(premium.isPremium(player));
        assertEq(word.balanceOf(address(premium)), amount, "escrow not funded");

        (address u, uint96 amt,, GriddlePremium.EscrowStatus status) = premium.escrows(externalId);
        assertEq(u, player);
        assertEq(amt, amount);
        assertTrue(status == GriddlePremium.EscrowStatus.Pending);
    }

    function test_unlockForUser_onlyManager() public {
        bytes32 externalId = keccak256("stripe_session_2");
        vm.prank(stranger);
        vm.expectRevert(GriddlePremium.NotEscrowManager.selector);
        premium.unlockForUser(player, 1e18, externalId);
    }

    function test_unlockForUser_duplicateExternalIdReverts() public {
        bytes32 externalId = keccak256("stripe_session_3");

        vm.startPrank(escrowManager);
        premium.unlockForUser(player, 1_000e18, externalId);
        vm.expectRevert(GriddlePremium.EscrowAlreadyExists.selector);
        premium.unlockForUser(player, 1_000e18, externalId);
        vm.stopPrank();
    }

    function test_burnEscrowed_beforeWindowReverts() public {
        bytes32 externalId = keccak256("stripe_session_4");
        vm.prank(escrowManager);
        premium.unlockForUser(player, 1_000e18, externalId);

        vm.warp(block.timestamp + 29 days);
        vm.expectRevert(GriddlePremium.EscrowStillLocked.selector);
        premium.burnEscrowed(externalId);
    }

    function test_burnEscrowed_afterWindowSucceeds() public {
        bytes32 externalId = keccak256("stripe_session_5");
        uint256 amount = 1_000e18;
        vm.prank(escrowManager);
        premium.unlockForUser(player, amount, externalId);

        uint256 supplyBefore = word.totalSupply();
        vm.warp(block.timestamp + 30 days + 1);
        premium.burnEscrowed(externalId);

        assertEq(word.totalSupply(), supplyBefore - amount, "not burned");
        (,,, GriddlePremium.EscrowStatus status) = premium.escrows(externalId);
        assertTrue(status == GriddlePremium.EscrowStatus.Burned);
    }

    function test_burnEscrowed_cannotBurnTwice() public {
        bytes32 externalId = keccak256("stripe_session_6");
        vm.prank(escrowManager);
        premium.unlockForUser(player, 1_000e18, externalId);

        vm.warp(block.timestamp + 31 days);
        premium.burnEscrowed(externalId);
        vm.expectRevert(GriddlePremium.EscrowNotPending.selector);
        premium.burnEscrowed(externalId);
    }

    function test_refundEscrow_ownerDuringWindow() public {
        bytes32 externalId = keccak256("stripe_session_7");
        uint256 amount = 1_000e18;
        vm.prank(escrowManager);
        premium.unlockForUser(player, amount, externalId);

        uint256 treasuryBefore = word.balanceOf(treasury);
        vm.prank(owner);
        premium.refundEscrow(externalId, treasury);

        assertEq(word.balanceOf(treasury), treasuryBefore + amount, "refund not received");
        (,,, GriddlePremium.EscrowStatus status) = premium.escrows(externalId);
        assertTrue(status == GriddlePremium.EscrowStatus.Refunded);
        // Premium is deliberately not auto-revoked on refund.
        assertTrue(premium.isPremium(player));
    }

    function test_refundEscrow_nonOwnerReverts() public {
        bytes32 externalId = keccak256("stripe_session_8");
        vm.prank(escrowManager);
        premium.unlockForUser(player, 1_000e18, externalId);

        vm.prank(stranger);
        vm.expectRevert();
        premium.refundEscrow(externalId, treasury);
    }

    function test_refundEscrow_cannotRefundBurned() public {
        bytes32 externalId = keccak256("stripe_session_9");
        vm.prank(escrowManager);
        premium.unlockForUser(player, 1_000e18, externalId);

        vm.warp(block.timestamp + 31 days);
        premium.burnEscrowed(externalId);

        vm.prank(owner);
        vm.expectRevert(GriddlePremium.EscrowNotPending.selector);
        premium.refundEscrow(externalId, treasury);
    }

    // --- Admin ------------------------------------------------------------

    function test_revokePremium() public {
        bytes32 externalId = keccak256("stripe_session_10");
        vm.prank(escrowManager);
        premium.unlockForUser(player, 1_000e18, externalId);
        assertTrue(premium.isPremium(player));

        vm.prank(owner);
        premium.revokePremium(player);
        assertFalse(premium.isPremium(player));
    }

    function test_setEscrowWindow_boundsEnforced() public {
        vm.startPrank(owner);
        vm.expectRevert(GriddlePremium.WindowOutOfBounds.selector);
        premium.setEscrowWindow(29 days);
        vm.expectRevert(GriddlePremium.WindowOutOfBounds.selector);
        premium.setEscrowWindow(121 days);
        premium.setEscrowWindow(60 days);
        vm.stopPrank();
        assertEq(premium.escrowWindow(), 60 days);
    }

    function test_setOracle_zeroReverts() public {
        vm.prank(owner);
        vm.expectRevert(GriddlePremium.ZeroAddress.selector);
        premium.setOracle(address(0));
    }

    // --- Helpers ----------------------------------------------------------

    function _signPermit(uint256 pk, address spender, uint256 amount)
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
                PERMIT_TYPEHASH, ownerAddr, spender, amount, word.nonces(ownerAddr), deadline
            )
        );
        bytes32 digest =
            keccak256(abi.encodePacked("\x19\x01", word.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(pk, digest);
    }
}
