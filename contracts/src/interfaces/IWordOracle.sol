// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice CoinGecko-backed oracle (extended from LHAW) that reports the
///         current USD price of $WORD with the timestamp of the last update.
/// @dev    `price` is 18-decimal USD per 1 $WORD (e.g. $0.000123 → 1.23e14).
interface IWordOracle {
    function getWordUsdPrice() external view returns (uint256 price, uint256 updatedAt);
}
