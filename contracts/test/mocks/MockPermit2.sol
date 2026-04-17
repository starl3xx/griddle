// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IPermit2 } from "../../src/interfaces/IPermit2.sol";

/// @notice Minimal Permit2 stand-in. Tracks (owner, token, spender)
///         allowances exactly like the real deployment, and exposes a
///         `transferFrom` that the mock Universal Router calls to pull
///         tokens. Enough to exercise the USDC → Permit2 → UR
///         approval dance in unit tests.
contract MockPermit2 is IPermit2 {
    struct PackedAllowance {
        uint160 amount;
        uint48 expiration;
    }

    // owner => token => spender => allowance
    mapping(address => mapping(address => mapping(address => PackedAllowance))) public allowance;

    function approve(address token, address spender, uint160 amount, uint48 expiration)
        external
        override
    {
        allowance[msg.sender][token][spender] = PackedAllowance(amount, expiration);
    }

    /// @notice Called by the mock Universal Router to pull tokens from
    ///         an owner who's approved this Permit2 + set a Permit2
    ///         allowance for the router.
    function transferFrom(address from, address to, uint160 amount, address token) external {
        PackedAllowance storage a = allowance[from][token][msg.sender];
        require(a.expiration >= block.timestamp, "PERMIT2_EXPIRED");
        require(a.amount >= amount, "PERMIT2_INSUFFICIENT_ALLOWANCE");
        if (a.amount != type(uint160).max) {
            a.amount -= amount;
        }
        require(IERC20(token).transferFrom(from, to, amount), "PERMIT2_TRANSFER_FAIL");
    }
}
