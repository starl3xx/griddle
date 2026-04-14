// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Ownable2Step, Ownable } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IWordToken } from "./interfaces/IWordToken.sol";
import { IWordOracle } from "./interfaces/IWordOracle.sol";

/**
 * @title GriddlePremium
 * @notice Two paths unlock Griddle Premium, both settle to burned $WORD:
 *
 *  1. **Crypto ($5)** — `unlockWithPermit` takes a signed ERC-2612 permit,
 *     pulls $WORD from the player, and burns it in the same transaction.
 *     No chargeback risk, so no escrow.
 *
 *  2. **Fiat ($6, Apple Pay / card)** — off-chain, the Stripe webhook charges
 *     the player and the backend swaps USD → $WORD on a DEX, then calls
 *     `unlockForUser` which pulls the freshly-swapped $WORD into this
 *     contract and records an escrow entry keyed by the Stripe session hash.
 *     The player becomes premium immediately. After `escrowWindow` (30 days
 *     default, covering the Stripe dispute window), anyone can call
 *     `burnEscrowed` to finalize the burn. If the player charges back during
 *     the window, the owner calls `refundEscrow` to return the tokens to
 *     the backend wallet so the USD refund can settle cleanly — no burn
 *     reversal needed.
 *
 *  `isPremium[user]` is the single flag the frontend reads to decide whether
 *  to show premium-only UI. Revocation on chargeback is deliberately manual
 *  via `revokePremium` so the owner can audit the action off-chain first.
 */
contract GriddlePremium is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --- Constants --------------------------------------------------------

    /// @notice $WORD token. Immutable (not `constant`) so tests can inject a
    ///         mock — on mainnet we still pin it to the Clanker v4 deployment
    ///         at 0x304e649e69979298BD1AEE63e175ADf07885fb4b, enforced by
    ///         the deploy script. Post-deploy the reference is unchangeable.
    // slither-disable-next-line naming-convention
    IWordToken public immutable WORD;

    /// @notice Target unlock price in USD, 18 decimals. $5.00.
    uint256 public constant UNLOCK_USD = 5e18;

    /// @notice Symmetric price slippage tolerance for the crypto path, %.
    uint256 public constant SLIPPAGE_PCT = 15;

    /// @notice Max age of an oracle price quote before it’s considered stale.
    uint256 public constant MAX_ORACLE_AGE = 5 minutes;

    /// @notice Lower bound on escrow window — owner can’t shrink below this.
    ///         30 days covers Stripe’s card dispute window for most schemes.
    uint256 public constant MIN_ESCROW_WINDOW = 30 days;

    /// @notice Upper bound on escrow window — protects players from an
    ///         owner stuck escrow configuration that never finalizes burns.
    uint256 public constant MAX_ESCROW_WINDOW = 120 days;

    // --- Storage ----------------------------------------------------------

    /// @notice Oracle contract for $WORD/USD. Owner-upgradable so a bad
    ///         feed can be swapped without redeploying this contract.
    IWordOracle public oracle;

    /// @notice Backend EOA permitted to open fiat escrows. It must hold (or
    ///         have allowance over) the $WORD being deposited.
    address public escrowManager;

    /// @notice Current escrow window — tokens cannot be burned before this.
    uint256 public escrowWindow = MIN_ESCROW_WINDOW;

    /// @notice Whether a given address has premium unlocked.
    mapping(address user => bool) public isPremium;

    enum EscrowStatus {
        None,
        Pending,
        Burned,
        Refunded
    }

    struct Escrow {
        address user;
        uint96 amount; // $WORD supply is 100B * 1e18 → fits in uint96.
        uint40 createdAt;
        EscrowStatus status;
    }

    /// @notice Escrow entries keyed by an external id (e.g. the hashed
    ///         Stripe checkout session id). Key doubles as idempotency key
    ///         for the webhook.
    mapping(bytes32 externalId => Escrow) public escrows;

    // --- Events -----------------------------------------------------------

    event UnlockedWithBurn(address indexed user, uint256 tokensBurned, uint256 oraclePrice);
    event EscrowOpened(bytes32 indexed externalId, address indexed user, uint256 amount);
    event EscrowBurned(bytes32 indexed externalId, address indexed user, uint256 amount);
    event EscrowRefunded(bytes32 indexed externalId, address indexed user, uint256 amount, address to);
    event PremiumRevoked(address indexed user);
    event OracleUpdated(address indexed oldOracle, address indexed newOracle);
    event EscrowManagerUpdated(address indexed oldManager, address indexed newManager);
    event EscrowWindowUpdated(uint256 oldWindow, uint256 newWindow);

    // --- Errors -----------------------------------------------------------

    error StaleOraclePrice();
    error TokenAmountOutOfBand();
    error OracleZeroPrice();
    error NotEscrowManager();
    error EscrowAlreadyExists();
    error EscrowNotPending();
    error EscrowStillLocked();
    error WindowOutOfBounds();
    error ZeroAddress();
    error ZeroAmount();
    error AmountOverflow();

    // --- Constructor ------------------------------------------------------

    constructor(
        address word_,
        address oracle_,
        address escrowManager_,
        address owner_
    ) Ownable(owner_) {
        if (
            word_ == address(0) || oracle_ == address(0)
                || escrowManager_ == address(0) || owner_ == address(0)
        ) {
            revert ZeroAddress();
        }
        WORD = IWordToken(word_);
        oracle = IWordOracle(oracle_);
        escrowManager = escrowManager_;
        emit OracleUpdated(address(0), oracle_);
        emit EscrowManagerUpdated(address(0), escrowManager_);
    }

    // --- Crypto path: direct permit + burn --------------------------------

    /**
     * @notice Unlock premium by paying $5 worth of $WORD in a single tx.
     * @dev    The caller presents a signed ERC-2612 permit that authorizes
     *         this contract to spend `tokenAmount` from their balance. We
     *         verify that `tokenAmount` is within ±15% of the oracle
     *         target (to protect against front-runnable bad prices), then
     *         burn the tokens directly. No escrow — crypto payments are
     *         final so the burn is safe immediately.
     */
    function unlockWithPermit(
        uint256 tokenAmount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        (uint256 price, uint256 updatedAt) = oracle.getWordUsdPrice();
        if (price == 0) revert OracleZeroPrice();
        if (block.timestamp - updatedAt > MAX_ORACLE_AGE) revert StaleOraclePrice();

        uint256 expected = (UNLOCK_USD * 1e18) / price;
        uint256 minTokens = (expected * (100 - SLIPPAGE_PCT)) / 100;
        uint256 maxTokens = (expected * (100 + SLIPPAGE_PCT)) / 100;
        if (tokenAmount < minTokens || tokenAmount > maxTokens) {
            revert TokenAmountOutOfBand();
        }

        // Permit first so the same tx can burn. We deliberately do NOT
        // try/catch the permit call — if the signature is invalid we want
        // the whole unlock to fail.
        WORD.permit(msg.sender, address(this), tokenAmount, deadline, v, r, s);
        WORD.burnFrom(msg.sender, tokenAmount);

        isPremium[msg.sender] = true;
        emit UnlockedWithBurn(msg.sender, tokenAmount, price);
    }

    // --- Fiat path: escrow-then-burn --------------------------------------

    /**
     * @notice Open an escrow for a fiat-paid unlock. Called by the backend
     *         after Stripe settles the USD charge and the backend has
     *         swapped it to $WORD. `externalId` is the hashed Stripe
     *         checkout session id and doubles as an idempotency key — a
     *         retried webhook won’t double-charge the treasury.
     * @dev    Caller must have approved this contract to spend `amount`
     *         of $WORD beforehand; tokens are pulled via `safeTransferFrom`.
     *         The player is marked premium immediately so the UI unlocks
     *         on the next page load — even though the burn is deferred.
     */
    function unlockForUser(
        address user,
        uint256 amount,
        bytes32 externalId
    ) external nonReentrant {
        if (msg.sender != escrowManager) revert NotEscrowManager();
        if (user == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (amount > type(uint96).max) revert AmountOverflow();
        if (escrows[externalId].status != EscrowStatus.None) revert EscrowAlreadyExists();

        // Cast is bounds-checked one line above; $WORD total supply is
        // 100B * 1e18 ≈ 2^86, well within uint96 range.
        // forge-lint: disable-next-line(unsafe-typecast)
        escrows[externalId] = Escrow({
            user: user,
            amount: uint96(amount),
            createdAt: uint40(block.timestamp),
            status: EscrowStatus.Pending
        });
        isPremium[user] = true;

        IERC20(address(WORD)).safeTransferFrom(msg.sender, address(this), amount);

        emit EscrowOpened(externalId, user, amount);
    }

    /**
     * @notice Finalize a fiat escrow by burning the held $WORD. Permissionless
     *         — anyone can call this after the dispute window elapses.
     *         Making it permissionless means a stalled backend can’t
     *         indefinitely delay burns.
     */
    function burnEscrowed(bytes32 externalId) external nonReentrant {
        Escrow storage e = escrows[externalId];
        if (e.status != EscrowStatus.Pending) revert EscrowNotPending();
        if (block.timestamp < e.createdAt + escrowWindow) revert EscrowStillLocked();

        uint256 amount = e.amount;
        address user = e.user;
        e.status = EscrowStatus.Burned;

        // Self-burn via ERC20Burnable.burn — using burnFrom(address(this), …)
        // would require the contract to hold a self-allowance, which would
        // cost an extra approve() per escrow with zero security benefit.
        WORD.burn(amount);
        emit EscrowBurned(externalId, user, amount);
    }

    /**
     * @notice Refund a fiat escrow back to the backend wallet. Owner-only,
     *         used when a chargeback / fraud signal arrives during the
     *         dispute window. Tokens return to `to` so the backend can
     *         swap back to USD and refund the player off-chain.
     * @dev    Does NOT automatically revoke premium — the owner should
     *         also call `revokePremium` if appropriate, after verifying
     *         the dispute is legitimate.
     */
    function refundEscrow(bytes32 externalId, address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        Escrow storage e = escrows[externalId];
        if (e.status != EscrowStatus.Pending) revert EscrowNotPending();

        uint256 amount = e.amount;
        address user = e.user;
        e.status = EscrowStatus.Refunded;

        IERC20(address(WORD)).safeTransfer(to, amount);
        emit EscrowRefunded(externalId, user, amount, to);
    }

    // --- Admin ------------------------------------------------------------

    function setOracle(address newOracle) external onlyOwner {
        if (newOracle == address(0)) revert ZeroAddress();
        emit OracleUpdated(address(oracle), newOracle);
        oracle = IWordOracle(newOracle);
    }

    function setEscrowManager(address newManager) external onlyOwner {
        if (newManager == address(0)) revert ZeroAddress();
        emit EscrowManagerUpdated(escrowManager, newManager);
        escrowManager = newManager;
    }

    function setEscrowWindow(uint256 newWindow) external onlyOwner {
        if (newWindow < MIN_ESCROW_WINDOW || newWindow > MAX_ESCROW_WINDOW) {
            revert WindowOutOfBounds();
        }
        emit EscrowWindowUpdated(escrowWindow, newWindow);
        escrowWindow = newWindow;
    }

    /**
     * @notice Revoke premium status from a user. Used to unwind a
     *         successful chargeback after the corresponding escrow has
     *         been refunded. Deliberately separate from `refundEscrow`
     *         so the owner can review before clipping premium access.
     */
    function revokePremium(address user) external onlyOwner {
        isPremium[user] = false;
        emit PremiumRevoked(user);
    }
}
