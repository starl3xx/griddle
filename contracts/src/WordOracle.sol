// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { IWordOracle } from "./interfaces/IWordOracle.sol";

/**
 * @title WordOracle
 * @notice Thin read-only adapter that derives the $WORD/USD per-token price
 *         from the LHAW JackpotManagerV3 market-cap oracle.
 *
 * The JackpotManager already receives periodic `updateClanktonMarketCap()`
 * calls from the LHAW backend. This adapter converts the stored 8-decimal
 * market cap into the 18-decimal per-token price that GriddlePremium needs —
 * no separate oracle cron required.
 *
 * Math:
 *   $WORD total supply = 100 000 000 000 tokens (100B)
 *   clanktonMarketCapUsd is 8-decimal USD  (e.g. 3 566 500 00000 = $35 665)
 *   price_18dec = marketCapUsd_8dec × 10^18
 *                 ─────────────────────────── = marketCapUsd_8dec / 10
 *                      10^8 × 100 × 10^9
 *
 * Staleness check: GriddlePremium rejects prices older than MAX_ORACLE_AGE
 * (5 min). The LHAW cron calls updateClanktonMarketCap on a sub-minute
 * cadence, so this adapter is always fresher than that threshold in practice.
 *
 * No admin surface, no storage, no upgradeability — the adapter is fully
 * stateless. Redeploy if the JackpotManager address ever changes.
 */
contract WordOracle is IWordOracle {
    /// @notice LHAW JackpotManagerV3 on Base mainnet.
    address public immutable jackpotManager;

    /// @notice $WORD total supply in whole tokens (100 billion).
    /// @dev    Used in price conversion: price_18dec = marketCapUsd_8dec × 1e18
    ///         / (1e8 × TOTAL_SUPPLY_TOKENS) = marketCapUsd_8dec / 10.
    uint256 public constant TOTAL_SUPPLY_TOKENS = 100_000_000_000;

    /// @dev price_18dec = marketCapUsd_8dec × 1e18 / (1e8 × TOTAL_SUPPLY_TOKENS)
    ///      Simplified: numerator and denominator share a factor of 1e9,
    ///      so the result is marketCapUsd_8dec × 1e9 / 1e8 = marketCapUsd_8dec / 10.
    ///      Stored here so a supply change updates both the docs and the math.
    uint256 private constant PRICE_DIVISOR = 1e8 * TOTAL_SUPPLY_TOKENS / 1e18;

    constructor(address jackpotManager_) {
        require(jackpotManager_ != address(0), "WordOracle: zero address");
        jackpotManager = jackpotManager_;
    }

    /**
     * @inheritdoc IWordOracle
     * @dev Reads `clanktonMarketCapUsd` (8-decimal) and `lastMarketCapUpdate`
     *      directly from JackpotManagerV3's public storage slots.
     *      Returns (0, 0) if the market cap has never been set — GriddlePremium
     *      will treat a zero price as a revert-worthy condition via OracleZeroPrice.
     */
    function getWordUsdPrice()
        external
        view
        override
        returns (uint256 price, uint256 updatedAt)
    {
        // JackpotManagerV3 public getters — no interface import needed.
        (bool ok1, bytes memory d1) = jackpotManager.staticcall(
            abi.encodeWithSignature("clanktonMarketCapUsd()")
        );
        (bool ok2, bytes memory d2) = jackpotManager.staticcall(
            abi.encodeWithSignature("lastMarketCapUpdate()")
        );

        if (!ok1 || !ok2 || d1.length < 32 || d2.length < 32) {
            return (0, 0);
        }

        uint256 marketCapUsd8 = abi.decode(d1, (uint256));
        uint256 lastUpdate    = abi.decode(d2, (uint256));

        // price_18dec = marketCapUsd_8dec × 1e18 / (1e8 × TOTAL_SUPPLY_TOKENS)
        price     = (marketCapUsd8 * 1e18) / (1e8 * TOTAL_SUPPLY_TOKENS);
        updatedAt = lastUpdate;
    }
}
