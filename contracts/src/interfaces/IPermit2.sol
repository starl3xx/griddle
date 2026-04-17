// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Minimal Permit2 surface — Universal Router reads allowances
///         through Permit2, so the contract must approve USDC → Permit2 →
///         Universal Router in a two-step dance.
///         Canonical Permit2 deployment on every chain:
///         0x000000000022D473030F116dDEE9F6B43aC78BA3.
interface IPermit2 {
    function approve(
        address token,
        address spender,
        uint160 amount,
        uint48 expiration
    ) external;
}
