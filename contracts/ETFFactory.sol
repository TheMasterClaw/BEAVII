// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {StockBasketVault} from "./StockBasketVault.sol";

interface IExchangeRegistry {
    function registerVault(address vault) external;
}

/// @title ETFFactory
/// @notice Lets anyone launch their own tokenized-stock ETF. Each ETF is a cheap EIP-1167 clone of
///         StockBasketVault, owned by its creator (the manager), who earns its management/entry/exit
///         fees. The protocol takes `protocolFeeBps` of those fees, capped at MAX_PROTOCOL_FEE_BPS.
contract ETFFactory is Ownable {
    struct CreateParams {
        string name;
        string symbol;
        string description;
        address feeRecipient; // 0 = the creator
        address[] tokens;
        uint256[] weights; // basis points, must sum to 10_000
        StockBasketVault.Fees fees;
    }

    uint256 public constant MAX_PROTOCOL_FEE_BPS = 3_000; // protocol keeps at most 30% of fees

    address public immutable implementation;
    address public immutable exchange;
    address public treasury;
    uint256 public protocolFeeBps;
    address public defaultAgent; // protocol rebalancing bot, authorized on new vaults (manager can revoke)

    address[] internal vaults;
    mapping(address => bool) public isVault;
    mapping(address => address[]) internal vaultsByManager;

    event ETFCreated(address indexed vault, address indexed manager, string name, string symbol);
    event TreasuryUpdated(address indexed treasury);
    event ProtocolFeeUpdated(uint256 bps);
    event DefaultAgentUpdated(address indexed agent);

    error FeeTooHigh();

    constructor(
        address implementation_,
        address exchange_,
        address treasury_,
        uint256 protocolFeeBps_,
        address defaultAgent_,
        address owner_
    ) Ownable(owner_) {
        if (protocolFeeBps_ > MAX_PROTOCOL_FEE_BPS) revert FeeTooHigh();
        implementation = implementation_;
        exchange = exchange_;
        treasury = treasury_;
        protocolFeeBps = protocolFeeBps_;
        defaultAgent = defaultAgent_;
    }

    function createETF(CreateParams calldata p) external returns (address vault) {
        return _create(p, msg.sender);
    }

    /// @notice Owner-only: launch an ETF on someone's behalf (used for the flagship basket at deploy).
    function createETFFor(CreateParams calldata p, address manager) external onlyOwner returns (address vault) {
        return _create(p, manager);
    }

    function setTreasury(address treasury_) external onlyOwner {
        treasury = treasury_;
        emit TreasuryUpdated(treasury_);
    }

    function setProtocolFeeBps(uint256 bps) external onlyOwner {
        if (bps > MAX_PROTOCOL_FEE_BPS) revert FeeTooHigh();
        protocolFeeBps = bps;
        emit ProtocolFeeUpdated(bps);
    }

    function setDefaultAgent(address agent) external onlyOwner {
        defaultAgent = agent;
        emit DefaultAgentUpdated(agent);
    }

    // ------------------------------------------------------------------ views

    function allETFs() external view returns (address[] memory) {
        return vaults;
    }

    function etfCount() external view returns (uint256) {
        return vaults.length;
    }

    function etfsOf(address manager) external view returns (address[] memory) {
        return vaultsByManager[manager];
    }

    // ------------------------------------------------------------------ internal

    function _create(CreateParams calldata p, address manager) internal returns (address vault) {
        vault = Clones.clone(implementation);
        IExchangeRegistry(exchange).registerVault(vault);
        StockBasketVault(vault).initialize(
            StockBasketVault.InitParams({
                name: p.name,
                symbol: p.symbol,
                description: p.description,
                exchange: exchange,
                manager: manager,
                feeRecipient: p.feeRecipient == address(0) ? manager : p.feeRecipient,
                agent: defaultAgent,
                tokens: p.tokens,
                weights: p.weights,
                fees: p.fees
            })
        );
        vaults.push(vault);
        isVault[vault] = true;
        vaultsByManager[manager].push(vault);
        emit ETFCreated(vault, manager, p.name, p.symbol);
    }
}
