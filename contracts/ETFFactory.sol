// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {StockBasketVault} from "./StockBasketVault.sol";
import {IPriceOracle, IVenue} from "./Interfaces.sol";

/// @title ETFFactory
/// @notice Launches tokenized-stock ETFs as EIP-1167 clones of StockBasketVault. Each ETF is owned by its
///         creator (the manager), who earns its management/entry/exit fees; the protocol takes
///         `protocolFeeBps` of those fees.
///
///         The oracle, venue and cash token are fixed at deploy time, so no admin can later point existing
///         vaults at a different price source or trading venue. The owner (a multisig on mainnet) controls
///         launch parameters within hard caps:
///         - who may create ETFs (`permissionless`, or the `approvedManagers` allowlist)
///         - `maxSlippageBps` every vault trade must fill within (<= 3%)
///         - `tvlCapUsd` per vault (0 = no cap), for a staged launch
///         - `sanctionsList` checked on deposits, redemptions and share transfers (0 = off)
///         The owner is also the guardian that can pause any vault (in-kind redemption still works).
contract ETFFactory is Ownable2Step {
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
    uint256 public constant MAX_SLIPPAGE_BPS = 300; // vault trades fill within 3% of the oracle price

    address public immutable implementation;
    address public immutable oracle;
    address public immutable venue;
    address public immutable cashToken;

    address public treasury;
    uint256 public protocolFeeBps;
    address public defaultAgent; // protocol rebalancing bot, authorized on new vaults (manager can revoke)
    uint256 public maxSlippageBps;
    uint256 public tvlCapUsd; // 18 decimals, 0 = unlimited
    address public sanctionsList;
    bool public permissionless;
    mapping(address => bool) public approvedManagers;

    address[] internal vaults;
    mapping(address => bool) public isVault;
    mapping(address => address[]) internal vaultsByManager;

    event ETFCreated(address indexed vault, address indexed manager, string name, string symbol);
    event TreasuryUpdated(address indexed treasury);
    event ProtocolFeeUpdated(uint256 bps);
    event DefaultAgentUpdated(address indexed agent);
    event MaxSlippageUpdated(uint256 bps);
    event TvlCapUpdated(uint256 capUsd);
    event SanctionsListUpdated(address list);
    event PermissionlessUpdated(bool open);
    event ManagerApproved(address indexed manager, bool approved);

    error FeeTooHigh();
    error SlippageTooHigh();
    error NotApprovedManager();
    error ZeroAddress();
    error CashMismatch();

    constructor(
        address implementation_,
        address oracle_,
        address venue_,
        address treasury_,
        uint256 protocolFeeBps_,
        address defaultAgent_,
        uint256 maxSlippageBps_,
        address owner_
    ) Ownable(owner_) {
        if (implementation_ == address(0) || oracle_ == address(0) || venue_ == address(0)) revert ZeroAddress();
        if (protocolFeeBps_ > MAX_PROTOCOL_FEE_BPS) revert FeeTooHigh();
        if (maxSlippageBps_ > MAX_SLIPPAGE_BPS) revert SlippageTooHigh();
        address cash = IVenue(venue_).cashToken();
        if (cash != IPriceOracle(oracle_).cashToken()) revert CashMismatch();
        implementation = implementation_;
        oracle = oracle_;
        venue = venue_;
        cashToken = cash;
        treasury = treasury_;
        protocolFeeBps = protocolFeeBps_;
        defaultAgent = defaultAgent_;
        maxSlippageBps = maxSlippageBps_;
    }

    function createETF(CreateParams calldata p) external returns (address vault) {
        if (!permissionless && !approvedManagers[msg.sender]) revert NotApprovedManager();
        return _create(p, msg.sender);
    }

    /// @notice Owner-only: launch an ETF on someone's behalf (used for the flagship basket at deploy).
    function createETFFor(CreateParams calldata p, address manager) external onlyOwner returns (address vault) {
        return _create(p, manager);
    }

    // ------------------------------------------------------------------ admin

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

    function setMaxSlippageBps(uint256 bps) external onlyOwner {
        if (bps > MAX_SLIPPAGE_BPS) revert SlippageTooHigh();
        maxSlippageBps = bps;
        emit MaxSlippageUpdated(bps);
    }

    function setTvlCapUsd(uint256 capUsd) external onlyOwner {
        tvlCapUsd = capUsd;
        emit TvlCapUpdated(capUsd);
    }

    function setSanctionsList(address list) external onlyOwner {
        sanctionsList = list;
        emit SanctionsListUpdated(list);
    }

    function setPermissionless(bool open) external onlyOwner {
        permissionless = open;
        emit PermissionlessUpdated(open);
    }

    function setManagerApproval(address manager, bool approved) external onlyOwner {
        approvedManagers[manager] = approved;
        emit ManagerApproved(manager, approved);
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

    function canCreate(address account) external view returns (bool) {
        return permissionless || approvedManagers[account];
    }

    // ------------------------------------------------------------------ internal

    function _create(CreateParams calldata p, address manager) internal returns (address vault) {
        vault = Clones.clone(implementation);
        IVenue(venue).registerVault(vault);
        StockBasketVault(vault).initialize(
            StockBasketVault.InitParams({
                name: p.name,
                symbol: p.symbol,
                description: p.description,
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
