// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { GriddlePremium } from "../src/GriddlePremium.sol";
import { IWordToken } from "../src/interfaces/IWordToken.sol";
import { MockWord } from "./mocks/MockWord.sol";
import { MockUsdc } from "./mocks/MockUsdc.sol";
import { MockOracle } from "./mocks/MockOracle.sol";
import { MockPermit2 } from "./mocks/MockPermit2.sol";
import { MockUniversalRouter } from "./mocks/MockUniversalRouter.sol";

contract GriddlePremiumTest is Test {
    GriddlePremium internal premium;
    MockWord internal word;
    MockUsdc internal usdc;
    MockOracle internal oracle;
    MockPermit2 internal permit2;
    MockUniversalRouter internal router;

    address internal owner = makeAddr("owner");
    address internal escrowManager = makeAddr("escrowManager");
    address internal treasury = makeAddr("treasury");
    address internal stranger = makeAddr("stranger");

    uint256 internal playerPk;
    address internal player;

    // Oracle price: $0.0001 per $WORD → to hit $5 you need 50,000 $WORD.
    uint256 internal constant PRICE = 1e14;
    uint256 internal constant EXPECTED_AMOUNT = 50_000e18;
    uint256 internal constant USDC_5 = 5_000_000; // $5 at 6 decimals.

    function setUp() public {
        playerPk = 0xA11CE;
        player = vm.addr(playerPk);

        word = new MockWord();
        usdc = new MockUsdc();
        oracle = new MockOracle(PRICE);
        permit2 = new MockPermit2();
        router = new MockUniversalRouter(address(permit2), address(usdc), address(word));

        premium = new GriddlePremium(
            address(word),
            address(usdc),
            address(router),
            address(permit2),
            address(oracle),
            escrowManager,
            owner
        );

        // Mint balances.
        usdc.mint(player, 1_000_000e6);
        word.mint(escrowManager, 1_000_000e18);

        // Escrow manager pre-approves $WORD allowance for the fiat path.
        vm.prank(escrowManager);
        word.approve(address(premium), type(uint256).max);

        // Owner configures the swap recipe. For the mock UR the
        // commands blob is a single dummy byte and `inputs[0]` holds
        // the USDC-in amount.
        bytes memory commands = hex"00";
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(USDC_5);

        vm.prank(owner);
        premium.setSwapConfig(commands, inputs);
    }

    // --- Crypto path: unlockWithUsdc --------------------------------------

    function test_unlockWithUsdc_happyPath() public {
        (uint256 deadline, uint8 v, bytes32 r, bytes32 s) =
            _signUsdcPermit(playerPk, address(premium), USDC_5);

        uint256 supplyBefore = word.totalSupply();
        uint256 playerUsdcBefore = usdc.balanceOf(player);

        uint256 minWordOut = (EXPECTED_AMOUNT * 95) / 100;

        vm.prank(player);
        premium.unlockWithUsdc(deadline, v, r, s, minWordOut);

        assertTrue(premium.isPremium(player), "premium flag not set");
        assertEq(usdc.balanceOf(player), playerUsdcBefore - USDC_5, "USDC not pulled");

        // Mock router mints $WORD at 10,000 per $1 → $5 = 50,000e18,
        // which is burned in the same tx.
        assertEq(
            word.totalSupply(),
            supplyBefore,
            "supply delta should be zero: minted-then-burned"
        );
        assertEq(word.balanceOf(address(premium)), 0, "contract should hold no $WORD after burn");
    }

    function test_unlockWithUsdc_staleOracleReverts() public {
        vm.warp(block.timestamp + 10 minutes);
        (uint256 deadline, uint8 v, bytes32 r, bytes32 s) =
            _signUsdcPermit(playerPk, address(premium), USDC_5);

        vm.expectRevert(GriddlePremium.StaleOraclePrice.selector);
        vm.prank(player);
        premium.unlockWithUsdc(deadline, v, r, s, (EXPECTED_AMOUNT * 95) / 100);
    }

    function test_unlockWithUsdc_zeroPriceReverts() public {
        oracle.setPrice(0);
        (uint256 deadline, uint8 v, bytes32 r, bytes32 s) =
            _signUsdcPermit(playerPk, address(premium), USDC_5);

        vm.expectRevert(GriddlePremium.OracleZeroPrice.selector);
        vm.prank(player);
        premium.unlockWithUsdc(deadline, v, r, s, (EXPECTED_AMOUNT * 95) / 100);
    }

    function test_unlockWithUsdc_minBelowFloorReverts() public {
        // Floor = expected * 0.95 = 47,500e18. 40,000e18 is below.
        uint256 tooLow = 40_000e18;
        (uint256 deadline, uint8 v, bytes32 r, bytes32 s) =
            _signUsdcPermit(playerPk, address(premium), USDC_5);

        vm.expectRevert(GriddlePremium.MinWordOutTooLow.selector);
        vm.prank(player);
        premium.unlockWithUsdc(deadline, v, r, s, tooLow);
    }

    function test_unlockWithUsdc_routerDeliversTooLittleReverts() public {
        // Router delivers only 1% of expected → minWordOut check trips.
        router.setWordPerUsdc(1e14);

        (uint256 deadline, uint8 v, bytes32 r, bytes32 s) =
            _signUsdcPermit(playerPk, address(premium), USDC_5);

        uint256 minWordOut = (EXPECTED_AMOUNT * 95) / 100;

        vm.expectRevert(GriddlePremium.SwapProducedInsufficientWord.selector);
        vm.prank(player);
        premium.unlockWithUsdc(deadline, v, r, s, minWordOut);
    }

    function test_unlockWithUsdc_routerSwallowsOutputReverts() public {
        router.setSwallowOutput(true);

        (uint256 deadline, uint8 v, bytes32 r, bytes32 s) =
            _signUsdcPermit(playerPk, address(premium), USDC_5);

        vm.expectRevert(GriddlePremium.SwapProducedInsufficientWord.selector);
        vm.prank(player);
        premium.unlockWithUsdc(deadline, v, r, s, (EXPECTED_AMOUNT * 95) / 100);
    }

    function test_unlockWithUsdc_routerRevertPropagates() public {
        router.setShouldRevert(true);

        (uint256 deadline, uint8 v, bytes32 r, bytes32 s) =
            _signUsdcPermit(playerPk, address(premium), USDC_5);

        vm.expectRevert(bytes("UR_FORCED_REVERT"));
        vm.prank(player);
        premium.unlockWithUsdc(deadline, v, r, s, (EXPECTED_AMOUNT * 95) / 100);
    }

    function test_unlockWithUsdc_swapConfigUnset_reverts() public {
        // Deploy fresh instance without setSwapConfig so the recipe is empty.
        GriddlePremium fresh = new GriddlePremium(
            address(word),
            address(usdc),
            address(router),
            address(permit2),
            address(oracle),
            escrowManager,
            owner
        );

        (uint256 deadline, uint8 v, bytes32 r, bytes32 s) =
            _signUsdcPermit(playerPk, address(fresh), USDC_5);

        vm.expectRevert(GriddlePremium.SwapConfigNotSet.selector);
        vm.prank(player);
        fresh.unlockWithUsdc(deadline, v, r, s, (EXPECTED_AMOUNT * 95) / 100);
    }

    function test_unlockWithUsdc_permitReplayReverts() public {
        (uint256 deadline, uint8 v, bytes32 r, bytes32 s) =
            _signUsdcPermit(playerPk, address(premium), USDC_5);

        vm.prank(player);
        premium.unlockWithUsdc(deadline, v, r, s, (EXPECTED_AMOUNT * 95) / 100);

        // Replaying the same permit: USDC's nonce has advanced, signature is invalid.
        vm.expectRevert();
        vm.prank(player);
        premium.unlockWithUsdc(deadline, v, r, s, (EXPECTED_AMOUNT * 95) / 100);
    }

    function test_setSwapConfig_validationReverts() public {
        bytes memory emptyCmds;
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(USDC_5);

        vm.prank(owner);
        vm.expectRevert(GriddlePremium.SwapConfigNotSet.selector);
        premium.setSwapConfig(emptyCmds, inputs);

        bytes memory cmds = hex"0001";
        bytes[] memory wrongLen = new bytes[](1);
        wrongLen[0] = abi.encode(USDC_5);

        vm.prank(owner);
        vm.expectRevert(GriddlePremium.SwapInputsMismatch.selector);
        premium.setSwapConfig(cmds, wrongLen);
    }

    function test_setSwapConfig_nonOwnerReverts() public {
        bytes memory cmds = hex"00";
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(USDC_5);

        vm.prank(stranger);
        vm.expectRevert();
        premium.setSwapConfig(cmds, inputs);
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

    // --- Sweep / rescue ---------------------------------------------------

    function test_sweepStrandedWord_respectsPendingEscrow() public {
        bytes32 externalId = keccak256("stripe_session_sweep_1");
        uint256 escrowed = 5_000e18;
        vm.prank(escrowManager);
        premium.unlockForUser(player, escrowed, externalId);

        // Donate extra $WORD directly to the contract (griefing-style).
        uint256 donation = 2_000e18;
        word.mint(address(premium), donation);

        vm.prank(owner);
        premium.sweepStrandedWord(treasury);

        assertEq(word.balanceOf(treasury), donation, "only donation should land at treasury");
        assertEq(
            word.balanceOf(address(premium)),
            escrowed,
            "escrow amount must remain in contract"
        );
    }

    function test_sweepStrandedWord_revertsWhenNothingStranded() public {
        bytes32 externalId = keccak256("stripe_session_sweep_2");
        vm.prank(escrowManager);
        premium.unlockForUser(player, 1_000e18, externalId);

        vm.prank(owner);
        vm.expectRevert(GriddlePremium.NothingToSweep.selector);
        premium.sweepStrandedWord(treasury);
    }

    function test_sweepStrandedWord_nonOwnerReverts() public {
        word.mint(address(premium), 1_000e18);
        vm.prank(stranger);
        vm.expectRevert();
        premium.sweepStrandedWord(treasury);
    }

    function test_sweepStrandedUsdc_sweepsAny() public {
        // Send USDC straight to contract (simulates stuck balance).
        usdc.mint(address(premium), 12_000_000);

        vm.prank(owner);
        premium.sweepStrandedUsdc(treasury);

        assertEq(usdc.balanceOf(treasury), 12_000_000);
        assertEq(usdc.balanceOf(address(premium)), 0);
    }

    function test_sweepStrandedUsdc_revertsWhenEmpty() public {
        vm.prank(owner);
        vm.expectRevert(GriddlePremium.NothingToSweep.selector);
        premium.sweepStrandedUsdc(treasury);
    }

    function test_totalPendingEscrow_updatesOnEachLifecycle() public {
        bytes32 id1 = keccak256("A");
        bytes32 id2 = keccak256("B");

        vm.startPrank(escrowManager);
        premium.unlockForUser(player, 1_000e18, id1);
        premium.unlockForUser(player, 2_000e18, id2);
        vm.stopPrank();

        assertEq(premium.totalPendingEscrow(), 3_000e18);

        vm.warp(block.timestamp + 31 days);
        premium.burnEscrowed(id1);
        assertEq(premium.totalPendingEscrow(), 2_000e18);

        vm.prank(owner);
        premium.refundEscrow(id2, treasury);
        assertEq(premium.totalPendingEscrow(), 0);
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
                PERMIT_TYPEHASH, ownerAddr, spender, amount, usdc.nonces(ownerAddr), deadline
            )
        );
        bytes32 digest =
            keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(pk, digest);
    }
}
