// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Ownable2Step, Ownable } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { IWordOracle } from "./interfaces/IWordOracle.sol";

/**
 * @title WordOracle
 * @notice Push oracle for the $WORD/USD price. A permissioned backend
 *         updater fetches the price from CoinGecko (via ORACLE_API_KEY)
 *         and posts it here on a regular cadence. GriddlePremium reads
 *         this to price crypto unlocks and fiat escrow opens.
 *
 * @dev    Price is 18-decimal USD per 1 $WORD.
 *         Example: $0.000123 per $WORD → price = 1.23e14
 *
 *         The updater key is a hot backend wallet. The owner (hardware
 *         wallet / multisig) can rotate the updater if the key is
 *         compromised without redeploying this contract or GriddlePremium.
 *
 *         GriddlePremium rejects prices older than MAX_ORACLE_AGE (5 min),
 *         so the backend must push at least every 4 minutes to avoid
 *         failed unlocks. A 1-minute cadence gives comfortable headroom.
 */
contract WordOracle is IWordOracle, Ownable2Step {
    // --- Storage ----------------------------------------------------------

    uint256 private _price;
    uint256 private _updatedAt;
    address public updater;

    // --- Events -----------------------------------------------------------

    event PriceUpdated(uint256 price, uint256 updatedAt);
    event UpdaterChanged(address indexed oldUpdater, address indexed newUpdater);

    // --- Errors -----------------------------------------------------------

    error NotUpdater();
    error ZeroPrice();
    error ZeroAddress();

    // --- Constructor ------------------------------------------------------

    constructor(address updater_, address owner_) Ownable(owner_) {
        if (updater_ == address(0) || owner_ == address(0)) revert ZeroAddress();
        updater = updater_;
        emit UpdaterChanged(address(0), updater_);
    }

    // --- Oracle interface -------------------------------------------------

    /**
     * @notice Returns the latest $WORD/USD price and the timestamp of the
     *         last update. Reverts are not used — callers (GriddlePremium)
     *         check staleness via `block.timestamp - updatedAt > MAX_ORACLE_AGE`.
     */
    function getWordUsdPrice() external view override returns (uint256 price, uint256 updatedAt) {
        return (_price, _updatedAt);
    }

    // --- Updater ----------------------------------------------------------

    /**
     * @notice Post a new price. Called by the backend on a ~1-minute cadence.
     * @param  price_     18-decimal USD per 1 $WORD (e.g. 1.23e14 for $0.000123)
     * @param  updatedAt_ Unix timestamp of the CoinGecko quote (not block time)
     *                    — lets callers detect stale API responses even if the
     *                    transaction lands late.
     */
    function updatePrice(uint256 price_, uint256 updatedAt_) external {
        if (msg.sender != updater) revert NotUpdater();
        if (price_ == 0) revert ZeroPrice();
        _price = price_;
        _updatedAt = updatedAt_;
        emit PriceUpdated(price_, updatedAt_);
    }

    // --- Admin ------------------------------------------------------------

    function setUpdater(address newUpdater) external onlyOwner {
        if (newUpdater == address(0)) revert ZeroAddress();
        emit UpdaterChanged(updater, newUpdater);
        updater = newUpdater;
    }
}
