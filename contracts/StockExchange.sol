// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Minimal surface of a Base B-20 Asset token (see github.com/base/base-std IB20.sol).
interface IB20Mintable {
    function decimals() external view returns (uint8);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function mint(address to, uint256 amount) external; // requires MINT_ROLE
    function burn(uint256 amount) external; // requires BURN_ROLE, burns caller balance
}

/// @title StockExchange
/// @notice Testnet stand-in for a trading venue, shared by every ETF on the platform.
///         - One NAV price feed for every listed stock token, pushed by the protocol agent.
///         - The only holder of MINT_ROLE / BURN_ROLE on the stock tokens and the cash token, so new
///           ETFs need no role grants: the factory registers each one here and it can then issue
///           (mint) and retire (burn) listed tokens at NAV.
///         On mainnet this contract would be replaced by real buys/sells through a venue.
/// @dev Prices are USD with 8 decimals per whole token (Chainlink NAV-feed convention).
contract StockExchange is Ownable {
    address public immutable cashToken;

    mapping(address => bool) public isListed;
    address[] internal listedTokens;
    mapping(address => bool) internal everListed;

    mapping(address => uint256) public price;
    mapping(address => uint256) public priceUpdatedAt;
    uint256 public maxPriceAge = 7 days;

    mapping(address => bool) public authorizedAgents;
    address public factory;
    mapping(address => bool) public isVault;

    event Listed(address indexed token, bool listed);
    event PricesUpdated(address[] tokens, uint256[] prices);
    event AgentUpdated(address indexed agent, bool authorized);
    event FactoryUpdated(address indexed factory);
    event VaultRegistered(address indexed vault);

    error NotAgent();
    error NotVault();
    error NotFactory();
    error NotListed(address token);
    error LengthMismatch();
    error ZeroPrice();
    error StalePrice(address token);

    modifier onlyAgent() {
        if (msg.sender != owner() && !authorizedAgents[msg.sender]) revert NotAgent();
        _;
    }

    modifier onlyVault() {
        if (!isVault[msg.sender]) revert NotVault();
        _;
    }

    constructor(address cashToken_, address agent_, address owner_) Ownable(owner_) {
        cashToken = cashToken_;
        if (agent_ != address(0)) {
            authorizedAgents[agent_] = true;
            emit AgentUpdated(agent_, true);
        }
    }

    // ------------------------------------------------------------------ admin

    function setListed(address[] calldata tokens, bool listed) external onlyOwner {
        for (uint256 i; i < tokens.length; ++i) {
            address t = tokens[i];
            if (t == cashToken) revert NotListed(t);
            if (listed && !everListed[t]) {
                everListed[t] = true;
                listedTokens.push(t);
            }
            isListed[t] = listed;
            emit Listed(t, listed);
        }
    }

    function setAgentAuthorization(address agent, bool authorized) external onlyOwner {
        authorizedAgents[agent] = authorized;
        emit AgentUpdated(agent, authorized);
    }

    function setFactory(address factory_) external onlyOwner {
        factory = factory_;
        emit FactoryUpdated(factory_);
    }

    function setMaxPriceAge(uint256 age) external onlyOwner {
        maxPriceAge = age;
    }

    function setPrices(address[] calldata tokens, uint256[] calldata prices) external onlyAgent {
        if (tokens.length != prices.length) revert LengthMismatch();
        for (uint256 i; i < tokens.length; ++i) {
            if (prices[i] == 0) revert ZeroPrice();
            price[tokens[i]] = prices[i];
            priceUpdatedAt[tokens[i]] = block.timestamp;
        }
        emit PricesUpdated(tokens, prices);
    }

    /// @notice Called by the ETF factory for every vault it creates.
    function registerVault(address vault) external {
        if (msg.sender != factory && msg.sender != owner()) revert NotFactory();
        isVault[vault] = true;
        emit VaultRegistered(vault);
    }

    // ------------------------------------------------------------------ vaults

    /// @notice Issue `amount` of a listed stock (or the cash token) to `to`.
    function mint(address token, address to, uint256 amount) external onlyVault {
        if (token != cashToken && !isListed[token]) revert NotListed(token);
        IB20Mintable(token).mint(to, amount);
    }

    /// @notice Retire `amount` of `token` that the calling vault has already transferred here.
    function burn(address token, uint256 amount) external onlyVault {
        IB20Mintable(token).burn(amount);
    }

    // ------------------------------------------------------------------ views

    /// @notice Price (8 decimals) that reverts if missing or older than maxPriceAge.
    function checkedPrice(address token) external view returns (uint256 p) {
        p = price[token];
        if (p == 0 || block.timestamp - priceUpdatedAt[token] > maxPriceAge) revert StalePrice(token);
    }

    function getListedTokens() external view returns (address[] memory out) {
        uint256 n;
        for (uint256 i; i < listedTokens.length; ++i) if (isListed[listedTokens[i]]) ++n;
        out = new address[](n);
        uint256 j;
        for (uint256 i; i < listedTokens.length; ++i) if (isListed[listedTokens[i]]) out[j++] = listedTokens[i];
    }
}
