// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Permit } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";

/// @notice Minimal $WORD interface — the Clanker v4 ClankerToken deployed at
///         0x304e649e69979298BD1AEE63e175ADf07885fb4b on Base mainnet inherits
///         ERC20Permit + ERC20Burnable, so both `permit` and `burnFrom` are available.
interface IWordToken is IERC20, IERC20Permit {
    function burn(uint256 amount) external;
    function burnFrom(address account, uint256 amount) external;
}
