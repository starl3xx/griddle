// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { IWordOracle } from "../../src/interfaces/IWordOracle.sol";

/// @notice Mutable oracle for tests — price and updatedAt can both be
///         manipulated to exercise staleness + slippage paths.
contract MockOracle is IWordOracle {
    uint256 public price;
    uint256 public updatedAt;

    constructor(uint256 price_) {
        price = price_;
        updatedAt = block.timestamp;
    }

    function setPrice(uint256 newPrice) external {
        price = newPrice;
        updatedAt = block.timestamp;
    }

    function setUpdatedAt(uint256 newUpdatedAt) external {
        updatedAt = newUpdatedAt;
    }

    function getWordUsdPrice() external view returns (uint256, uint256) {
        return (price, updatedAt);
    }
}
