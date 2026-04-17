// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Minimal surface of Uniswap's Universal Router we interact with.
///         Base mainnet deployment: 0x6fF5693b99212Da76ad316178A184AB56D299b43.
interface IUniversalRouter {
    function execute(
        bytes calldata commands,
        bytes[] calldata inputs,
        uint256 deadline
    ) external payable;
}
