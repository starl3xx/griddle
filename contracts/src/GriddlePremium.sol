// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Ownable2Step, Ownable } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Permit } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";

import { IWordToken } from "./interfaces/IWordToken.sol";
import { IWordOracle } from "./interfaces/IWordOracle.sol";
import { IUniversalRouter } from "./interfaces/IUniversalRouter.sol";
import { IPermit2 } from "./interfaces/IPermit2.sol";

/**
 * @title GriddlePremium
 * @notice Two paths unlock Griddle Premium, both settle to burned $WORD:
 *
 *  1. **Crypto ($5 USDC)** — `unlockWithUsdc` takes a signed ERC-2612
 *     permit over $5 of native Base USDC, pulls the USDC into this
 *     contract, routes it through Uniswap's Universal Router
 *     (USDC → WETH → $WORD) using an owner-configured swap recipe, and
 *     burns every $WORD the swap produced. No chargeback risk, so the
 *     burn is immediate with no escrow.
 *
 *  2. **Fiat ($6, Apple Pay / card)** — off-chain, the Stripe webhook
 *     charges the player and the backend calls `unlockForUser`, which
 *     pulls $WORD from the escrow manager's pre-staged stockpile into
 *     this contract and records an escrow entry keyed by the Stripe
 *     session hash. The player becomes premium immediately. After
 *     `escrowWindow` (30 days default, covering the Stripe dispute
 *     window), anyone can call `burnEscrowed` to finalize the burn. If
 *     the player charges back during the window, the owner calls
 *     `refundEscrow` to return the tokens to the backend wallet so the
 *     USD refund can settle cleanly — no burn reversal needed.
 *
 *  `isPremium[user]` is the single flag the frontend reads to decide
 *  whether to show premium-only UI. Revocation on chargeback is
 *  deliberately manual via `revokePremium` so the owner can audit the
 *  action off-chain first.
 *
 *  The USDC swap recipe is owner-configurable rather than hardcoded
 *  because $WORD is a Clanker v4 token whose pool can migrate. Security
 *  still comes from the **balance-snapshot invariant**: regardless of
 *  how the swap is routed, the contract only burns $WORD that actually
 *  lands on this address, and reverts if the delta is below
 *  `minWordOut` — which itself is floored to the oracle-derived
 *  expected amount minus `SWAP_SLIPPAGE_PCT`.
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

    /// @notice Native Base USDC used for the crypto path. Pinned to
    ///         0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 by the deploy
    ///         script; immutable so tests can inject a mock.
    // slither-disable-next-line naming-convention
    IERC20Permit public immutable USDC;

    /// @notice Uniswap Universal Router that executes the USDC → $WORD
    ///         swap. Base mainnet deployment is
    ///         0x6fF5693b99212Da76ad316178A184AB56D299b43 (verify against
    ///         Uniswap's deployments JSON at deploy time).
    // slither-disable-next-line naming-convention
    address public immutable UNIVERSAL_ROUTER;

    /// @notice Canonical Permit2 on Base mainnet. Universal Router reads
    ///         allowances through Permit2, so we have to approve USDC →
    ///         Permit2 → Universal Router.
    // slither-disable-next-line naming-convention
    address public immutable PERMIT2;

    /// @notice Target unlock price in USD, 18 decimals. $5.00.
    uint256 public constant UNLOCK_USD = 5e18;

    /// @notice Fixed $5 USDC (6 decimals) pulled for the crypto unlock.
    uint256 public constant USDC_UNLOCK_AMOUNT = 5_000_000;

    /// @notice Symmetric price slippage tolerance (%) on the atomic USDC
    ///         swap. Tighter than the old permit-path band because the
    ///         swap is single-block — MEV can't drift the price here.
    uint256 public constant SWAP_SLIPPAGE_PCT = 5;

    /// @notice Max age of an oracle price quote before it's considered stale.
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

    /// @notice Sum of $WORD wei currently held in Pending escrows. Used
    ///         by `sweepStrandedWord` so rescue can’t touch legitimate
    ///         escrowed funds. Updated on open/burn/refund.
    uint256 public totalPendingEscrow;

    /// @notice Owner-configured Universal Router `commands` blob executed
    ///         on every USDC unlock. The owner encodes the USDC → WETH →
    ///         $WORD path (typically V3_SWAP_EXACT_IN then V4_SWAP).
    bytes public swapCommands;

    /// @notice Owner-configured Universal Router `inputs` array. Each
    ///         element matches the command at the same position in
    ///         `swapCommands`.
    bytes[] internal _swapInputs;

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

    event UnlockedWithUsdcSwap(
        address indexed user,
        uint256 usdcIn,
        uint256 wordBurned,
        uint256 oraclePrice
    );
    event EscrowOpened(bytes32 indexed externalId, address indexed user, uint256 amount);
    event EscrowBurned(bytes32 indexed externalId, address indexed user, uint256 amount);
    event EscrowRefunded(bytes32 indexed externalId, address indexed user, uint256 amount, address to);
    event PremiumRevoked(address indexed user);
    event OracleUpdated(address indexed oldOracle, address indexed newOracle);
    event EscrowManagerUpdated(address indexed oldManager, address indexed newManager);
    event EscrowWindowUpdated(uint256 oldWindow, uint256 newWindow);
    event SwapConfigUpdated(uint256 commandsLength, uint256 inputsCount);
    event StrandedSwept(address indexed token, address indexed to, uint256 amount);

    // --- Errors -----------------------------------------------------------

    error StaleOraclePrice();
    error MinWordOutTooLow();
    error SwapProducedInsufficientWord();
    error OracleZeroPrice();
    error NotEscrowManager();
    error EscrowAlreadyExists();
    error EscrowNotPending();
    error EscrowStillLocked();
    error WindowOutOfBounds();
    error ZeroAddress();
    error ZeroAmount();
    error AmountOverflow();
    error SwapConfigNotSet();
    error SwapInputsMismatch();
    error NothingToSweep();
    error ConstructorInterfaceMismatch();

    // --- Constructor ------------------------------------------------------

    constructor(
        address word_,
        address usdc_,
        address universalRouter_,
        address permit2_,
        address oracle_,
        address escrowManager_,
        address owner_
    ) Ownable(owner_) {
        if (
            word_ == address(0) || usdc_ == address(0) || universalRouter_ == address(0)
                || permit2_ == address(0) || oracle_ == address(0)
                || escrowManager_ == address(0) || owner_ == address(0)
        ) {
            revert ZeroAddress();
        }
        WORD = IWordToken(word_);
        USDC = IERC20Permit(usdc_);
        UNIVERSAL_ROUTER = universalRouter_;
        PERMIT2 = permit2_;
        oracle = IWordOracle(oracle_);
        escrowManager = escrowManager_;

        // Interface smoke tests — any accidental constructor-argument
        // reorder (all 7 params are same-typed `address`) would land
        // wildly wrong contracts at each slot. A silent misdeploy is
        // worse than a loud revert on `forge script`, so these probes
        // catch the mix-up before bytecode ships.
        //
        // USDC: must expose ERC-2612 `DOMAIN_SEPARATOR()`.
        try IERC20Permit(usdc_).DOMAIN_SEPARATOR() returns (bytes32) {} catch {
            revert ConstructorInterfaceMismatch();
        }
        // Oracle: must expose `getWordUsdPrice()`.
        try IWordOracle(oracle_).getWordUsdPrice() returns (uint256, uint256) {} catch {
            revert ConstructorInterfaceMismatch();
        }
        // WORD: must expose ERC-20 `totalSupply()`. We don't require a
        //       non-zero supply — Clanker's mainnet $WORD is 100B × 1e18
        //       at deploy, but test fixtures deploy before minting.
        try IERC20(word_).totalSupply() returns (uint256) {} catch {
            revert ConstructorInterfaceMismatch();
        }

        emit OracleUpdated(address(0), oracle_);
        emit EscrowManagerUpdated(address(0), escrowManager_);
    }

    // --- Crypto path: USDC permit → swap → burn ---------------------------

    /**
     * @notice Unlock premium by paying $5 USDC in a single tx. The contract
     *         routes the USDC through Uniswap to $WORD and burns the
     *         proceeds. The caller never has to touch $WORD.
     * @dev    `minWordOut` is floored to the oracle-derived expected
     *         amount minus `SWAP_SLIPPAGE_PCT` — callers can ask for
     *         more, never less. The actual WORD burned is whatever the
     *         swap delivers to this contract (measured by balance delta),
     *         never the caller's claim.
     */
    function unlockWithUsdc(
        uint256 permitDeadline,
        uint8 v,
        bytes32 r,
        bytes32 s,
        uint256 minWordOut
    ) external nonReentrant {
        // 1. Oracle sanity + floor minWordOut.
        (uint256 price, uint256 updatedAt) = oracle.getWordUsdPrice();
        if (price == 0) revert OracleZeroPrice();
        if (block.timestamp - updatedAt > MAX_ORACLE_AGE) revert StaleOraclePrice();

        uint256 expected = (UNLOCK_USD * 1e18) / price;
        uint256 minFloor = (expected * (100 - SWAP_SLIPPAGE_PCT)) / 100;
        if (minWordOut < minFloor) revert MinWordOutTooLow();

        // 2. Swap recipe must be configured.
        bytes memory commands = swapCommands;
        if (commands.length == 0) revert SwapConfigNotSet();
        bytes[] memory inputs = _swapInputs;
        if (inputs.length == 0) revert SwapConfigNotSet();

        // 3. Pull USDC via ERC-2612 permit.
        IERC20Permit(address(USDC)).permit(
            msg.sender,
            address(this),
            USDC_UNLOCK_AMOUNT,
            permitDeadline,
            v,
            r,
            s
        );
        IERC20(address(USDC)).safeTransferFrom(msg.sender, address(this), USDC_UNLOCK_AMOUNT);

        // 4. Top up USDC→Permit2 allowance only when needed, and refresh
        //    Permit2→Universal Router each call. Permit2's allowance
        //    storage is a single slot, so re-setting it is cheap. Reuse
        //    the caller-supplied `permitDeadline` so a stale transaction
        //    sitting in the mempool past its own permit window can't
        //    still execute a swap — passing `block.timestamp + 60` here
        //    would make the Universal Router's deadline check
        //    trivially true and give validators unlimited replay.
        if (IERC20(address(USDC)).allowance(address(this), PERMIT2) < USDC_UNLOCK_AMOUNT) {
            IERC20(address(USDC)).forceApprove(PERMIT2, type(uint256).max);
        }
        IPermit2(PERMIT2).approve(
            address(USDC),
            UNIVERSAL_ROUTER,
            type(uint160).max,
            uint48(permitDeadline)
        );

        // 5. Snapshot, swap, verify delta.
        uint256 wordBefore = IERC20(address(WORD)).balanceOf(address(this));
        IUniversalRouter(UNIVERSAL_ROUTER).execute(commands, inputs, permitDeadline);
        uint256 wordReceived = IERC20(address(WORD)).balanceOf(address(this)) - wordBefore;
        if (wordReceived < minWordOut) revert SwapProducedInsufficientWord();

        // 6. Flip premium, burn, emit.
        isPremium[msg.sender] = true;
        WORD.burn(wordReceived);
        emit UnlockedWithUsdcSwap(msg.sender, USDC_UNLOCK_AMOUNT, wordReceived, price);
    }

    // --- Fiat path: escrow-then-burn --------------------------------------

    /**
     * @notice Open an escrow for a fiat-paid unlock. Called by the backend
     *         after Stripe settles the USD charge. The backend pulls
     *         $WORD from the pre-staged escrow manager stockpile —
     *         there's no DEX swap on this path, the stockpile is the
     *         inventory. `externalId` is the hashed Stripe checkout
     *         session id and doubles as an idempotency key — a retried
     *         webhook won't double-charge the treasury.
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
        totalPendingEscrow += amount;

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
        totalPendingEscrow -= amount;

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
        totalPendingEscrow -= amount;

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
     * @notice Configure the USDC → $WORD swap recipe executed by the
     *         Universal Router. Owner-only. Call again after a Clanker
     *         pool migration or fee-tier change. The balance-snapshot +
     *         `minWordOut` floor means a mis-configured recipe can only
     *         revert — it cannot divert funds or grant premium without
     *         a genuine burn.
     */
    function setSwapConfig(bytes calldata commands, bytes[] calldata inputs) external onlyOwner {
        if (commands.length == 0) revert SwapConfigNotSet();
        if (inputs.length == 0 || inputs.length != commands.length) revert SwapInputsMismatch();

        swapCommands = commands;
        delete _swapInputs;
        for (uint256 i = 0; i < inputs.length; i++) {
            _swapInputs.push(inputs[i]);
        }
        emit SwapConfigUpdated(commands.length, inputs.length);
    }

    /// @notice Read a single swap-input entry (array is internal so the
    ///         compiler doesn't auto-generate a getter that's painful to
    ///         consume from off-chain tools).
    function swapInputs(uint256 index) external view returns (bytes memory) {
        return _swapInputs[index];
    }

    function swapInputsLength() external view returns (uint256) {
        return _swapInputs.length;
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

    /**
     * @notice Sweep $WORD tokens that landed on this contract outside
     *         the escrow accounting — most commonly a direct
     *         `transfer()` donation. Respects `totalPendingEscrow` so
     *         legitimate escrowed tokens cannot be touched; only the
     *         excess is rescuable.
     */
    function sweepStrandedWord(address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        uint256 balance = IERC20(address(WORD)).balanceOf(address(this));
        if (balance <= totalPendingEscrow) revert NothingToSweep();
        uint256 stranded;
        unchecked {
            stranded = balance - totalPendingEscrow;
        }
        IERC20(address(WORD)).safeTransfer(to, stranded);
        emit StrandedSwept(address(WORD), to, stranded);
    }

    /**
     * @notice Sweep USDC accidentally left on this contract. The
     *         `unlockWithUsdc` flow is atomic (pull + swap + burn in
     *         one tx), so USDC should never persist here under normal
     *         operation — any balance is a leftover from an aborted
     *         path and belongs to the owner to return out-of-band.
     */
    function sweepStrandedUsdc(address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        uint256 balance = IERC20(address(USDC)).balanceOf(address(this));
        if (balance == 0) revert NothingToSweep();
        IERC20(address(USDC)).safeTransfer(to, balance);
        emit StrandedSwept(address(USDC), to, balance);
    }
}
