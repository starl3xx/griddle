// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Ownable2Step, Ownable } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title GriddleRewards
 * @notice Streak-milestone rewards, paid in $WORD, settled onchain via
 *         a signed voucher from the backend signer.
 *
 *  Flow:
 *   1. Backend watches solves, decides which streak milestone a player
 *      just crossed (e.g. 7-day → X $WORD, 30-day → Y $WORD), and signs
 *      an EIP-712 voucher `(user, milestone, amount, nonce, deadline)`.
 *   2. Player calls `claim` with the voucher. Contract verifies the
 *      signer is the configured `rewardSigner`, that the voucher hasn’t
 *      been claimed (per-user nonces mapped to a `claimed` bitset), and
 *      that `block.timestamp <= deadline`. Then it transfers $WORD out.
 *
 *  Why not merkle roots: vouchers let us reward a single player on demand
 *  without regenerating and publishing a daily root. No gas cost to the
 *  backend for "eligible but unclaimed" players.
 *
 *  Treasury model: this contract holds its own $WORD balance, topped up
 *  by the owner via `fund()` (pull pattern) or direct transfer. Owner can
 *  withdraw unused balance with `sweep`.
 */
contract GriddleRewards is Ownable2Step, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    // --- Types ------------------------------------------------------------

    /// @dev EIP-712 typehash for the claim voucher. Keep in sync with the
    ///      backend signer implementation — any drift invalidates claims.
    bytes32 private constant CLAIM_TYPEHASH = keccak256(
        "Claim(address user,uint256 milestone,uint256 amount,uint256 nonce,uint256 deadline)"
    );

    // --- Storage ----------------------------------------------------------

    /// @notice $WORD token. Set at construction, immutable for safety.
    IERC20 public immutable word;

    /// @notice Address whose signature is accepted on vouchers. Owner-settable
    ///         so the signing key can be rotated without redeploying.
    address public rewardSigner;

    /// @notice `claimed[user][nonce]` — set to true when consumed. Per-user
    ///         nonces mean the backend can run parallel issuance without
    ///         global lock contention.
    mapping(address user => mapping(uint256 nonce => bool)) public claimed;

    // --- Events -----------------------------------------------------------

    event Claimed(
        address indexed user,
        uint256 indexed milestone,
        uint256 amount,
        uint256 nonce
    );
    event RewardSignerUpdated(address indexed oldSigner, address indexed newSigner);
    event Funded(address indexed from, uint256 amount);
    event Swept(address indexed to, uint256 amount);

    // --- Errors -----------------------------------------------------------

    error InvalidSignature();
    error VoucherExpired();
    error AlreadyClaimed();
    error ZeroAddress();
    error ZeroAmount();
    error InsufficientBalance();

    // --- Constructor ------------------------------------------------------

    constructor(
        address word_,
        address rewardSigner_,
        address owner_
    ) Ownable(owner_) EIP712("GriddleRewards", "1") {
        if (word_ == address(0) || rewardSigner_ == address(0) || owner_ == address(0)) {
            revert ZeroAddress();
        }
        word = IERC20(word_);
        rewardSigner = rewardSigner_;
        emit RewardSignerUpdated(address(0), rewardSigner_);
    }

    // --- Claim ------------------------------------------------------------

    /**
     * @notice Redeem a signed voucher for $WORD.
     * @dev    The voucher binds to a single `user` (the `msg.sender`), so
     *         a leaked voucher can’t be hijacked. `nonce` is arbitrary —
     *         the backend can use a counter or a hash of the milestone —
     *         the only requirement is uniqueness per user.
     */
    function claim(
        uint256 milestone,
        uint256 amount,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant {
        if (block.timestamp > deadline) revert VoucherExpired();
        if (amount == 0) revert ZeroAmount();
        if (claimed[msg.sender][nonce]) revert AlreadyClaimed();

        bytes32 structHash = keccak256(
            abi.encode(CLAIM_TYPEHASH, msg.sender, milestone, amount, nonce, deadline)
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, signature);
        if (signer != rewardSigner) revert InvalidSignature();

        claimed[msg.sender][nonce] = true;

        if (word.balanceOf(address(this)) < amount) revert InsufficientBalance();
        word.safeTransfer(msg.sender, amount);

        emit Claimed(msg.sender, milestone, amount, nonce);
    }

    /// @notice Convenience view for off-chain flows — returns the digest
    ///         the backend must sign for a given voucher payload.
    function hashClaim(
        address user,
        uint256 milestone,
        uint256 amount,
        uint256 nonce,
        uint256 deadline
    ) external view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(CLAIM_TYPEHASH, user, milestone, amount, nonce, deadline)
        );
        return _hashTypedDataV4(structHash);
    }

    // --- Admin ------------------------------------------------------------

    /// @notice Pull-pattern top-up: owner transfers $WORD into this contract.
    ///         Equivalent to a direct transfer, but emits a Funded event for
    ///         easy indexing of treasury flows.
    function fund(uint256 amount) external onlyOwner {
        if (amount == 0) revert ZeroAmount();
        word.safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, amount);
    }

    function sweep(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        word.safeTransfer(to, amount);
        emit Swept(to, amount);
    }

    function setRewardSigner(address newSigner) external onlyOwner {
        if (newSigner == address(0)) revert ZeroAddress();
        emit RewardSignerUpdated(rewardSigner, newSigner);
        rewardSigner = newSigner;
    }
}
