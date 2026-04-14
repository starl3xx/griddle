// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { GriddleRewards } from "../src/GriddleRewards.sol";
import { MockWord } from "./mocks/MockWord.sol";

contract GriddleRewardsTest is Test {
    GriddleRewards internal rewards;
    MockWord internal word;

    address internal owner = makeAddr("owner");
    address internal player = makeAddr("player");
    address internal stranger = makeAddr("stranger");

    uint256 internal signerPk = 0xBEEF;
    address internal signer;

    bytes32 internal constant CLAIM_TYPEHASH = keccak256(
        "Claim(address user,uint256 milestone,uint256 amount,uint256 nonce,uint256 deadline)"
    );

    function setUp() public {
        signer = vm.addr(signerPk);

        word = new MockWord();
        rewards = new GriddleRewards(address(word), signer, owner);

        // Fund the rewards contract directly.
        word.mint(address(rewards), 1_000_000e18);
    }

    // --- Happy path -------------------------------------------------------

    function test_claim_happyPath() public {
        uint256 milestone = 7;
        uint256 amount = 100e18;
        uint256 nonce = 1;
        uint256 deadline = block.timestamp + 1 days;

        bytes memory sig = _signVoucher(player, milestone, amount, nonce, deadline);

        uint256 playerBefore = word.balanceOf(player);
        vm.prank(player);
        rewards.claim(milestone, amount, nonce, deadline, sig);

        assertEq(word.balanceOf(player), playerBefore + amount);
        assertTrue(rewards.claimed(player, nonce));
    }

    // --- Replay protection ------------------------------------------------

    function test_claim_replayReverts() public {
        uint256 milestone = 7;
        uint256 amount = 100e18;
        uint256 nonce = 2;
        uint256 deadline = block.timestamp + 1 days;

        bytes memory sig = _signVoucher(player, milestone, amount, nonce, deadline);

        vm.startPrank(player);
        rewards.claim(milestone, amount, nonce, deadline, sig);
        vm.expectRevert(GriddleRewards.AlreadyClaimed.selector);
        rewards.claim(milestone, amount, nonce, deadline, sig);
        vm.stopPrank();
    }

    // --- Signature binding ------------------------------------------------

    function test_claim_wrongSignerReverts() public {
        uint256 badPk = 0xDEAD;
        uint256 amount = 100e18;
        uint256 nonce = 3;
        uint256 deadline = block.timestamp + 1 days;

        // Sign with the wrong key.
        bytes32 structHash = keccak256(
            abi.encode(CLAIM_TYPEHASH, player, uint256(7), amount, nonce, deadline)
        );
        bytes32 digest = _toTypedDataHash(structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(badPk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.prank(player);
        vm.expectRevert(GriddleRewards.InvalidSignature.selector);
        rewards.claim(7, amount, nonce, deadline, sig);
    }

    function test_claim_voucherBoundToUserReverts() public {
        // Sign a voucher addressed to player…
        uint256 amount = 100e18;
        uint256 nonce = 4;
        uint256 deadline = block.timestamp + 1 days;
        bytes memory sig = _signVoucher(player, 7, amount, nonce, deadline);

        // …but have stranger try to redeem it. Claim path binds to msg.sender,
        // so the recovered signer won't match and the claim reverts.
        vm.prank(stranger);
        vm.expectRevert(GriddleRewards.InvalidSignature.selector);
        rewards.claim(7, amount, nonce, deadline, sig);
    }

    // --- Deadline ---------------------------------------------------------

    function test_claim_expiredDeadlineReverts() public {
        uint256 deadline = block.timestamp + 1 days;
        bytes memory sig = _signVoucher(player, 7, 100e18, 5, deadline);

        vm.warp(deadline + 1);
        vm.prank(player);
        vm.expectRevert(GriddleRewards.VoucherExpired.selector);
        rewards.claim(7, 100e18, 5, deadline, sig);
    }

    // --- Admin ------------------------------------------------------------

    function test_fund_viaOwner() public {
        word.mint(owner, 1_000e18);
        vm.startPrank(owner);
        word.approve(address(rewards), 1_000e18);
        rewards.fund(1_000e18);
        vm.stopPrank();
        assertEq(word.balanceOf(address(rewards)), 1_001_000e18);
    }

    function test_sweep_ownerOnly() public {
        vm.prank(stranger);
        vm.expectRevert();
        rewards.sweep(stranger, 100e18);

        vm.prank(owner);
        rewards.sweep(owner, 100e18);
        assertEq(word.balanceOf(owner), 100e18);
    }

    function test_setRewardSigner_ownerOnly() public {
        address newSigner = makeAddr("newSigner");
        vm.prank(stranger);
        vm.expectRevert();
        rewards.setRewardSigner(newSigner);

        vm.prank(owner);
        rewards.setRewardSigner(newSigner);
        assertEq(rewards.rewardSigner(), newSigner);
    }

    function test_claim_insufficientBalanceReverts() public {
        // Drain the rewards contract first.
        vm.prank(owner);
        rewards.sweep(owner, 1_000_000e18);

        uint256 amount = 100e18;
        uint256 nonce = 10;
        uint256 deadline = block.timestamp + 1 days;
        bytes memory sig = _signVoucher(player, 7, amount, nonce, deadline);

        vm.prank(player);
        vm.expectRevert(GriddleRewards.InsufficientBalance.selector);
        rewards.claim(7, amount, nonce, deadline, sig);
    }

    // --- Helpers ----------------------------------------------------------

    function _signVoucher(
        address user,
        uint256 milestone,
        uint256 amount,
        uint256 nonce,
        uint256 deadline
    ) internal view returns (bytes memory) {
        bytes32 structHash =
            keccak256(abi.encode(CLAIM_TYPEHASH, user, milestone, amount, nonce, deadline));
        bytes32 digest = _toTypedDataHash(structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _toTypedDataHash(bytes32 structHash) internal view returns (bytes32) {
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes("GriddleRewards")),
                keccak256(bytes("1")),
                block.chainid,
                address(rewards)
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }
}
