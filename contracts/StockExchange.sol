// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IB20Mintable, IPriceOracle, IVenue} from "./Interfaces.sol";

/// @title StockExchange (TESTNET ONLY)
/// @notice Stand-in trading venue for Base Sepolia. It holds MINT_ROLE / BURN_ROLE on the test stock
///         tokens and the test cash token and fills every order at the oracle NAV by issuing and retiring
///         tokens. It must never be deployed on mainnet: there, the factory is wired to a real venue
///         adapter such as UniswapV3Venue.
/// @dev Only vaults registered by the factory may trade, and the factory can be set exactly once.
contract StockExchange is Ownable2Step, IVenue {
    using SafeERC20 for IERC20;

    address public immutable cashToken;
    IPriceOracle public immutable oracle;
    uint8 internal immutable cashDecimals;

    address public factory;
    mapping(address => bool) public isVault;

    event FactorySet(address indexed factory);
    event VaultRegistered(address indexed vault);
    event Traded(address indexed vault, address indexed token, bool buy, uint256 amountIn, uint256 amountOut);

    error NotVault();
    error NotFactory();
    error FactoryAlreadySet();
    error NotListed(address token);
    error Slippage(uint256 out, uint256 minOut);
    error OracleMismatch();

    modifier onlyVault() {
        if (!isVault[msg.sender]) revert NotVault();
        _;
    }

    constructor(IPriceOracle oracle_, address owner_) Ownable(owner_) {
        oracle = oracle_;
        cashToken = oracle_.cashToken();
        cashDecimals = IB20Mintable(cashToken).decimals();
    }

    /// @notice One-time wiring to the ETF factory. Afterwards nobody, not even the owner, can register vaults.
    function setFactory(address factory_) external onlyOwner {
        if (factory != address(0)) revert FactoryAlreadySet();
        factory = factory_;
        emit FactorySet(factory_);
    }

    function registerVault(address vault) external {
        if (msg.sender != factory) revert NotFactory();
        isVault[vault] = true;
        emit VaultRegistered(vault);
    }

    /// @notice Pull `cashIn` from the vault and issue the stock at NAV.
    function buy(address token, uint256 cashIn, uint256 minTokenOut) external onlyVault returns (uint256 out) {
        if (!oracle.isListed(token)) revert NotListed(token);
        IERC20(cashToken).safeTransferFrom(msg.sender, address(this), cashIn);
        IB20Mintable(cashToken).burn(cashIn);
        uint256 usd = cashIn * 10 ** (18 - cashDecimals);
        out = (usd * 10 ** IB20Mintable(token).decimals()) / (oracle.checkedPrice(token) * 1e10);
        if (out < minTokenOut) revert Slippage(out, minTokenOut);
        if (out > 0) IB20Mintable(token).mint(msg.sender, out);
        emit Traded(msg.sender, token, true, cashIn, out);
    }

    /// @notice Pull `tokenIn` of a stock from the vault, retire it, and pay cash at NAV.
    function sell(address token, uint256 tokenIn, uint256 minCashOut) external onlyVault returns (uint256 out) {
        IERC20(token).safeTransferFrom(msg.sender, address(this), tokenIn);
        IB20Mintable(token).burn(tokenIn);
        uint256 usd = (tokenIn * oracle.checkedPrice(token) * 1e10) / (10 ** IB20Mintable(token).decimals());
        out = usd / 10 ** (18 - cashDecimals);
        if (out < minCashOut) revert Slippage(out, minCashOut);
        if (out > 0) IB20Mintable(cashToken).mint(msg.sender, out);
        emit Traded(msg.sender, token, false, tokenIn, out);
    }
}
