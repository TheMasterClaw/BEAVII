// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Minimal surface of a Base B-20 Asset token (see github.com/base/base-std IB20.sol).
///         Only the testnet StockExchange mints and burns; the vault itself uses plain ERC-20 calls.
interface IB20Mintable {
    function decimals() external view returns (uint8);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function mint(address to, uint256 amount) external; // requires MINT_ROLE
    function burn(uint256 amount) external; // requires BURN_ROLE, burns caller balance
}

/// @notice USD prices with 8 decimals per whole token, plus the registry of assets ETFs may hold.
interface IPriceOracle {
    function cashToken() external view returns (address);
    function isListed(address token) external view returns (bool);
    function price(address token) external view returns (uint256);
    function priceUpdatedAt(address token) external view returns (uint256);
    function maxPriceAge() external view returns (uint256);
    /// @dev Reverts if the price is missing or stale, or if the L2 sequencer is down.
    function checkedPrice(address token) external view returns (uint256);
}

/// @notice Where vaults buy and sell stock tokens for the cash token.
///         Both calls pull the input from msg.sender (which must have approved the venue) and send the
///         output to msg.sender. Vaults never trust the return value: they measure balance changes and
///         enforce their own minimums against the oracle price.
interface IVenue {
    function cashToken() external view returns (address);
    function buy(address token, uint256 cashIn, uint256 minTokenOut) external returns (uint256 tokenOut);
    function sell(address token, uint256 tokenIn, uint256 minCashOut) external returns (uint256 cashOut);
    /// @notice Called by the factory for every new vault. Venues that do not gate callers make it a no-op.
    function registerVault(address vault) external;
}

/// @notice Chainalysis-style sanctions list (isSanctioned(address)).
interface ISanctionsList {
    function isSanctioned(address account) external view returns (bool);
}

/// @notice Chainlink AggregatorV3 (also used for the L2 sequencer uptime feed).
interface AggregatorV3Interface {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @notice What a vault reads from the factory that created it.
interface IETFFactory {
    function owner() external view returns (address);
    function oracle() external view returns (address);
    function venue() external view returns (address);
    function cashToken() external view returns (address);
    function treasury() external view returns (address);
    function protocolFeeBps() external view returns (uint256);
    function maxSlippageBps() external view returns (uint256);
    function tvlCapUsd() external view returns (uint256);
    function sanctionsList() external view returns (address);
}
