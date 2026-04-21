// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { IWordOracle } from "./interfaces/IWordOracle.sol";

/**
 * @title PushedWordOracle
 * @notice Server-pushed replacement for the LHAW-backed WordOracle.
 *
 * Why: the original WordOracle proxies LHAW's JackpotManagerV3 market-cap
 * state, whose freshness depends on a cron run by the LHAW team. When that
 * cron lags, GriddlePremium's 5-minute staleness check reverts every
 * `unlockWithUsdc` call and crypto checkout breaks — entirely outside our
 * control. $WORD lives in a Clanker v4 pool on Uniswap v4 which has no
 * native TWAP, so a direct on-chain read isn't viable.
 *
 * Instead: Griddle's own cron (Vercel, every 2 minutes) reads the $WORD/USDC
 * price from GeckoTerminal, converts to the 18-decimal USD-per-$WORD shape
 * GriddlePremium expects, and pushes it here via `setPrice`. `updatedAt`
 * gets stamped with `block.timestamp` on each write so GriddlePremium's
 * freshness check passes. The oracle is swapped in via
 * `GriddlePremium.setOracle(newOracle)` — no GriddlePremium redeploy.
 *
 * Trust model: whoever controls the `updater` EOA controls the price feed.
 * The EOA's key lives in Vercel env and is used only by the cron route,
 * never touched manually. Compromise would let an attacker set arbitrary
 * prices; the worst-case impact is a 5%-slippage-floor miss on a $5 unlock
 * against a pool with ~$29k TVL (small, bounded). No bounds-check on new
 * price — $WORD can legitimately move 50%+ intraday at this liquidity, so
 * tight bounds would cause more false rejections than they'd prevent abuse.
 *
 * Zero-price writes are rejected so GriddlePremium's `OracleZeroPrice`
 * guard never triggers from an updater bug that wrote `0`. GriddlePremium
 * still checks zero-price on its own — this is belt-and-suspenders.
 *
 * No admin surface, no owner, no upgradeability. Replace by deploying a
 * new oracle and calling `setOracle` on GriddlePremium.
 */
contract PushedWordOracle is IWordOracle {
    /// @notice EOA authorized to push price updates. Set once at deploy.
    address public immutable updater;

    /// @notice Current USD price of 1 $WORD in 18-decimal fixed-point.
    ///         Example: $0.000123 → `1.23e14`.
    uint256 public price;

    /// @notice Unix timestamp of the most recent `setPrice` write.
    uint256 public updatedAt;

    /// @notice Emitted on every successful price push. Off-chain monitors
    ///         can watch this to detect cron lag.
    event PriceUpdated(uint256 price, uint256 timestamp);

    error NotUpdater();
    error ZeroPrice();
    error ZeroAddress();

    constructor(address updater_) {
        if (updater_ == address(0)) revert ZeroAddress();
        updater = updater_;
    }

    /**
     * @notice Push a fresh price. Stamps `updatedAt = block.timestamp`.
     * @param  newPrice USD-per-$WORD in 18-decimal fixed-point. Must be non-zero.
     */
    function setPrice(uint256 newPrice) external {
        if (msg.sender != updater) revert NotUpdater();
        if (newPrice == 0) revert ZeroPrice();
        price = newPrice;
        updatedAt = block.timestamp;
        emit PriceUpdated(newPrice, block.timestamp);
    }

    /// @inheritdoc IWordOracle
    function getWordUsdPrice()
        external
        view
        override
        returns (uint256, uint256)
    {
        return (price, updatedAt);
    }
}
