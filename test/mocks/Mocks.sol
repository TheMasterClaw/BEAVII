// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IPriceOracle, IVenue} from "../../contracts/Interfaces.sol";

/// @dev B-20-like token: open mint, burn of the caller's balance.
contract MockToken is ERC20 {
    uint8 internal immutable _dec;

    constructor(string memory n, uint8 d) ERC20(n, n) {
        _dec = d;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}

contract MockAggregator {
    uint8 public decimals;
    int256 public answer;
    uint256 public startedAt;
    uint256 public updatedAt;

    constructor(uint8 d) {
        decimals = d;
    }

    function set(int256 a, uint256 started, uint256 updated) external {
        answer = a;
        startedAt = started;
        updatedAt = updated;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, startedAt, updatedAt, 1);
    }
}

contract MockSanctions {
    mapping(address => bool) public isSanctioned;

    function set(address a, bool s) external {
        isSanctioned[a] = s;
    }
}

/// @dev Venue that fills at the oracle price minus `haircutBps` (simulates slippage or a bad pool).
contract HaircutVenue is IVenue {
    address public immutable cashToken;
    IPriceOracle public immutable oracle;
    uint256 public haircutBps;

    constructor(IPriceOracle oracle_, uint256 haircutBps_) {
        oracle = oracle_;
        cashToken = oracle_.cashToken();
        haircutBps = haircutBps_;
    }

    function registerVault(address) external {}

    function buy(address token, uint256 cashIn, uint256) external returns (uint256 out) {
        IERC20(cashToken).transferFrom(msg.sender, address(this), cashIn);
        uint256 usd = cashIn * 10 ** (18 - IERC20Metadata(cashToken).decimals());
        out = (usd * 10 ** IERC20Metadata(token).decimals()) / (oracle.checkedPrice(token) * 1e10);
        out = (out * (10_000 - haircutBps)) / 10_000;
        MockToken(token).mint(msg.sender, out);
    }

    function sell(address token, uint256 tokenIn, uint256) external returns (uint256 out) {
        IERC20(token).transferFrom(msg.sender, address(this), tokenIn);
        uint256 usd = (tokenIn * oracle.checkedPrice(token) * 1e10) / 10 ** IERC20Metadata(token).decimals();
        out = (usd / 10 ** (18 - IERC20Metadata(cashToken).decimals()) * (10_000 - haircutBps)) / 10_000;
        MockToken(cashToken).mint(msg.sender, out);
    }
}

/// @dev SwapRouter02-shaped router filling at a fixed rate (out per 1e18 in), honouring amountOutMinimum.
contract MockSwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    mapping(address => mapping(address => uint256)) public rate;
    uint24 public lastFee;

    function setRate(address tokenIn, address tokenOut, uint256 outPer1e18) external {
        rate[tokenIn][tokenOut] = outPer1e18;
    }

    function exactInputSingle(ExactInputSingleParams calldata p) external payable returns (uint256 out) {
        IERC20(p.tokenIn).transferFrom(msg.sender, address(this), p.amountIn);
        out = (p.amountIn * rate[p.tokenIn][p.tokenOut]) / 1e18;
        require(out >= p.amountOutMinimum, "Too little received");
        lastFee = p.fee;
        MockToken(p.tokenOut).mint(p.recipient, out);
    }
}
