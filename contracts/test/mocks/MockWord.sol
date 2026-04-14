// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC20Permit } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import { ERC20Burnable } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/// @notice Minimal stand-in for the Clanker v4 $WORD token — inherits the
///         same extensions (Permit + Burnable) so tests cover the real
///         code paths in GriddlePremium / GriddleRewards.
contract MockWord is ERC20, ERC20Permit, ERC20Burnable {
    constructor() ERC20("Mock Word", "WORD") ERC20Permit("Mock Word") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
