// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IUniversalRouter } from "../../src/interfaces/IUniversalRouter.sol";
import { MockPermit2 } from "./MockPermit2.sol";
import { MockWord } from "./MockWord.sol";

/// @notice Minimal Universal Router stand-in that emulates a USDC →
///         $WORD swap. Reads the USDC-in amount from `inputs[0]` (as a
///         plain uint256 ABI-encoded), pulls USDC from the caller via
///         Permit2, then mints $WORD to the caller at a configurable
///         rate. Enough to cover the balance-snapshot invariant in
///         unit tests without pulling real Uniswap pools.
contract MockUniversalRouter is IUniversalRouter {
    MockPermit2 public immutable PERMIT2;
    IERC20 public immutable USDC;
    MockWord public immutable WORD;

    /// @notice $WORD wei delivered per single USDC unit (6 decimals).
    ///         Default: 10,000 $WORD per $1 → 50,000e18 $WORD per $5 →
    ///         1e16 WORD wei per USDC unit.
    uint256 public wordPerUsdc = 1e16;

    /// @notice When true, `execute` reverts — used to test the router
    ///         revert path.
    bool public shouldRevert;

    /// @notice When true, `execute` transfers USDC but does NOT deliver
    ///         $WORD — used to test the balance-snapshot invariant.
    bool public swallowOutput;

    constructor(address permit2_, address usdc_, address word_) {
        PERMIT2 = MockPermit2(permit2_);
        USDC = IERC20(usdc_);
        WORD = MockWord(word_);
    }

    function setWordPerUsdc(uint256 newRate) external {
        wordPerUsdc = newRate;
    }

    function setShouldRevert(bool v) external {
        shouldRevert = v;
    }

    function setSwallowOutput(bool v) external {
        swallowOutput = v;
    }

    function execute(bytes calldata /* commands */, bytes[] calldata inputs, uint256 deadline)
        external
        payable
        override
    {
        require(block.timestamp <= deadline, "UR_EXPIRED");
        require(!shouldRevert, "UR_FORCED_REVERT");
        require(inputs.length >= 1, "UR_NO_INPUT");

        uint256 usdcIn = abi.decode(inputs[0], (uint256));
        PERMIT2.transferFrom(msg.sender, address(this), uint160(usdcIn), address(USDC));

        if (!swallowOutput) {
            uint256 wordOut = usdcIn * wordPerUsdc;
            WORD.mint(msg.sender, wordOut);
        }
    }
}
