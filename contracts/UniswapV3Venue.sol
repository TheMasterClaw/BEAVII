// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IVenue} from "./Interfaces.sol";

/// @notice Uniswap SwapRouter02 (no deadline field in the params struct).
interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

/// @title UniswapV3Venue
/// @notice Mainnet venue: routes vault trades through a Uniswap V3 SwapRouter02 single-hop pool
///         (cash token <-> stock token). The owner picks the fee tier per token; a token without a pool fee
///         cannot be traded.
///
///         The venue holds no funds between calls and needs no caller gating: it only ever moves the
///         caller's own tokens. Price protection comes from `minOut`, which every vault derives from the
///         oracle price minus the factory's slippage cap, so a manipulated or wrong pool reverts the trade
///         instead of filling it badly.
/// @dev Before relying on this, confirm on a Base mainnet fork that each listed stock has a pool with enough
///      depth, and that the stock token allows the router, the venue and the vaults to hold and transfer it.
contract UniswapV3Venue is Ownable2Step, IVenue {
    using SafeERC20 for IERC20;

    address public immutable cashToken;
    ISwapRouter02 public immutable router;
    mapping(address => uint24) public poolFee;

    event PoolFeeSet(address indexed token, uint24 fee);

    error NoPool(address token);
    error ZeroAddress();

    constructor(address cashToken_, ISwapRouter02 router_, address owner_) Ownable(owner_) {
        if (cashToken_ == address(0) || address(router_) == address(0)) revert ZeroAddress();
        cashToken = cashToken_;
        router = router_;
    }

    function setPoolFee(address token, uint24 fee) external onlyOwner {
        poolFee[token] = fee;
        emit PoolFeeSet(token, fee);
    }

    /// @inheritdoc IVenue
    function registerVault(address) external pure {}

    function buy(address token, uint256 cashIn, uint256 minTokenOut) external returns (uint256) {
        return _swap(cashToken, token, poolFee[token], cashIn, minTokenOut);
    }

    function sell(address token, uint256 tokenIn, uint256 minCashOut) external returns (uint256) {
        return _swap(token, cashToken, poolFee[token], tokenIn, minCashOut);
    }

    function _swap(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint256 minOut)
        internal
        returns (uint256 out)
    {
        if (fee == 0) revert NoPool(tokenIn == cashToken ? tokenOut : tokenIn);
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenIn).forceApprove(address(router), amountIn);
        out = router.exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: fee,
                recipient: msg.sender,
                amountIn: amountIn,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96: 0
            })
        );
        IERC20(tokenIn).forceApprove(address(router), 0);
    }
}
