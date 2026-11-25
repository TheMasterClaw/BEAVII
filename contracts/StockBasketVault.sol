// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IB20Mintable} from "./StockExchange.sol";

interface IStockExchange {
    function cashToken() external view returns (address);
    function isListed(address token) external view returns (bool);
    function price(address token) external view returns (uint256);
    function priceUpdatedAt(address token) external view returns (uint256);
    function maxPriceAge() external view returns (uint256);
    function checkedPrice(address token) external view returns (uint256);
    function mint(address token, address to, uint256 amount) external;
    function burn(address token, uint256 amount) external;
}

interface IETFFactory {
    function treasury() external view returns (address);
    function protocolFeeBps() external view returns (uint256);
    function owner() external view returns (address);
}

/// @title StockBasketVault
/// @notice A user-created tokenized-stock ETF on Base Sepolia. Each vault is an EIP-1167 clone made by
///         ETFFactory. The creator is the vault's owner (the "manager"): they pick the basket, set
///         target weights, rebalance, and earn fees for running it.
///
///         Fees (all paid as newly minted or transferred vault shares, so they track the ETF's value):
///         - management fee: annual rate, streamed continuously by diluting supply (max 5%/yr)
///         - entry fee: % of each deposit (max 1%)
///         - exit fee: % of each redemption (max 1%)
///         The protocol takes `protocolFeeBps` of every fee (set on the factory, capped at 30%) and the
///         rest goes to the manager's `feeRecipient`.
///
///         Holder protections: fee increases only apply after FEE_TIMELOCK; fee decreases apply at once.
///         In-kind redemption works even while the vault is paused, so holders can always exit.
///         Trades happen at the shared StockExchange NAV, so rebalancing is value-neutral.
/// @dev Share token and all USD values returned by views use 18 decimals.
contract StockBasketVault is ERC20, Ownable, Pausable, ReentrancyGuard {
    struct Asset {
        address token;
        uint256 targetWeight; // basis points
        uint256 balance; // vault balance of the token (raw units)
        bool active;
    }

    struct AssetView {
        address token;
        uint256 targetWeight;
        uint256 balance;
        uint256 price; // USD, 8 decimals
        uint256 priceUpdatedAt;
        uint256 valueUsd; // 18 decimals
        uint8 decimals;
    }

    struct Fees {
        uint16 managementFeeBps; // per year
        uint16 entryFeeBps;
        uint16 exitFeeBps;
    }

    struct InitParams {
        string name;
        string symbol;
        string description;
        address exchange;
        address manager;
        address feeRecipient;
        address agent; // optional rebalancing bot (0 = none)
        address[] tokens;
        uint256[] weights;
        Fees fees;
    }

    enum FeeKind {
        Management,
        Entry,
        Exit
    }

    uint256 public constant BASIS_POINTS = 10_000;
    uint256 public constant MAX_ASSETS = 20;
    uint256 public constant PRICE_DECIMALS = 8;
    uint256 public constant YEAR = 365 days;
    uint256 public constant MAX_MANAGEMENT_FEE_BPS = 500; // 5% per year
    uint256 public constant MAX_ENTRY_FEE_BPS = 100; // 1%
    uint256 public constant MAX_EXIT_FEE_BPS = 100; // 1%
    uint256 public constant FEE_TIMELOCK = 3 days;
    /// @dev Burned on the first deposit (minted to DEAD) so the first depositor can't inflate the share price
    ///      by donating tokens and round later depositors down. 1e9 shares ~= $0.000000001.
    uint256 public constant DEAD_SHARES = 1e9;
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    bool private _initialized;
    string private _name;
    string private _symbol;
    string public description;

    IStockExchange public exchange;
    IB20Mintable public cashToken;
    uint8 public cashDecimals;
    address public factory;

    mapping(address => bool) public authorizedAgents;

    address[] internal assetList;
    mapping(address => Asset) internal assetInfo;
    uint256 public lastRebalanceTime;
    uint256 public createdAt;

    // fees
    address public feeRecipient;
    Fees public fees;
    Fees public pendingFees;
    uint256 public pendingFeesEta; // 0 = nothing queued
    uint256 public lastFeeAccrual;
    uint256 public managerFeeShares; // cumulative shares paid to the manager
    uint256 public protocolFeeShares; // cumulative shares paid to the protocol
    uint256 public managerFeesUsd; // cumulative USD value at time of payment, 18 decimals
    uint256 public protocolFeesUsd;

    event Initialized(address indexed manager, string name, string symbol);
    event AssetAdded(address indexed token, uint256 weight);
    event AssetRemoved(address indexed token);
    event WeightsUpdated(address[] tokens, uint256[] weights);
    event Deposited(address indexed user, address indexed token, uint256 amount, uint256 valueUsd, uint256 shares);
    event Withdrawn(address indexed user, address indexed tokenOut, uint256 shares, uint256 amountOut);
    event Rebalanced(uint256 totalValueUsd);
    event AgentUpdated(address indexed agent, bool authorized);
    event FeesPaid(FeeKind indexed kind, uint256 managerShares, uint256 protocolShares, uint256 valueUsd);
    event FeesQueued(uint16 managementFeeBps, uint16 entryFeeBps, uint16 exitFeeBps, uint256 eta);
    event FeesUpdated(uint16 managementFeeBps, uint16 entryFeeBps, uint16 exitFeeBps);
    event FeeRecipientUpdated(address indexed recipient);
    event DescriptionUpdated(string description);

    error AlreadyInitialized();
    error NotAgent();
    error NotGuardian();
    error UnknownAsset(address token);
    error AssetExists(address token);
    error TooManyAssets();
    error BadWeights(uint256 total);
    error LengthMismatch();
    error ZeroAmount();
    error ZeroAddress();
    error Slippage(uint256 out, uint256 minOut);
    error UnsupportedToken(address token);
    error FeeTooHigh();
    error FeesNotReady();
    error BadName();

    modifier onlyAgent() {
        if (msg.sender != owner() && !authorizedAgents[msg.sender]) revert NotAgent();
        _;
    }

    /// @dev The implementation contract is locked; clones start uninitialized (all storage zero).
    constructor() ERC20("", "") Ownable(address(0xdead)) {
        _initialized = true;
    }

    function initialize(InitParams calldata p) external {
        if (_initialized) revert AlreadyInitialized();
        _initialized = true;
        if (p.manager == address(0) || p.exchange == address(0)) revert ZeroAddress();
        if (bytes(p.name).length == 0 || bytes(p.name).length > 64) revert BadName();
        if (bytes(p.symbol).length == 0 || bytes(p.symbol).length > 12) revert BadName();
        if (p.tokens.length != p.weights.length) revert LengthMismatch();
        if (p.tokens.length == 0 || p.tokens.length > MAX_ASSETS) revert TooManyAssets();

        _name = p.name;
        _symbol = p.symbol;
        description = p.description;
        factory = msg.sender;
        exchange = IStockExchange(p.exchange);
        cashToken = IB20Mintable(exchange.cashToken());
        cashDecimals = cashToken.decimals();
        feeRecipient = p.feeRecipient == address(0) ? p.manager : p.feeRecipient;
        createdAt = block.timestamp;
        lastFeeAccrual = block.timestamp;
        _transferOwnership(p.manager);

        if (p.agent != address(0)) {
            authorizedAgents[p.agent] = true;
            emit AgentUpdated(p.agent, true);
        }
        for (uint256 i; i < p.tokens.length; ++i) _addAsset(p.tokens[i], p.weights[i]);
        uint256 total = getTotalTargetWeight();
        if (total != BASIS_POINTS) revert BadWeights(total);
        _applyFees(p.fees);
        emit Initialized(p.manager, p.name, p.symbol);
    }

    function name() public view override returns (string memory) {
        return _name;
    }

    function symbol() public view override returns (string memory) {
        return _symbol;
    }

    // ------------------------------------------------------------------ manager

    function addAsset(address token, uint256 targetWeight) external onlyOwner {
        _addAsset(token, targetWeight);
    }

    /// @notice Deactivates an asset. Its holdings are sold out on the next rebalance.
    function removeAsset(address token) external onlyOwner {
        Asset storage a = assetInfo[token];
        if (!a.active) revert UnknownAsset(token);
        a.active = false;
        a.targetWeight = 0;
        emit AssetRemoved(token);
    }

    function setWeights(address[] calldata tokens, uint256[] calldata weights) external onlyOwner {
        if (tokens.length != weights.length) revert LengthMismatch();
        for (uint256 i; i < tokens.length; ++i) {
            if (!assetInfo[tokens[i]].active) revert UnknownAsset(tokens[i]);
            assetInfo[tokens[i]].targetWeight = weights[i];
        }
        uint256 total = getTotalTargetWeight();
        if (total != BASIS_POINTS) revert BadWeights(total);
        emit WeightsUpdated(tokens, weights);
    }

    /// @notice Lower fees apply immediately. Any increase is queued for FEE_TIMELOCK so holders can exit.
    function setFees(Fees calldata next) external onlyOwner {
        _validateFees(next);
        accrueFees();
        if (
            next.managementFeeBps <= fees.managementFeeBps && next.entryFeeBps <= fees.entryFeeBps
                && next.exitFeeBps <= fees.exitFeeBps
        ) {
            delete pendingFees;
            pendingFeesEta = 0;
            _applyFees(next);
        } else {
            pendingFees = next;
            pendingFeesEta = block.timestamp + FEE_TIMELOCK;
            emit FeesQueued(next.managementFeeBps, next.entryFeeBps, next.exitFeeBps, pendingFeesEta);
        }
    }

    /// @notice Anyone can activate queued fees once the timelock has passed.
    function applyPendingFees() external {
        if (pendingFeesEta == 0 || block.timestamp < pendingFeesEta) revert FeesNotReady();
        accrueFees();
        Fees memory next = pendingFees;
        delete pendingFees;
        pendingFeesEta = 0;
        _applyFees(next);
    }

    function setFeeRecipient(address recipient) external onlyOwner {
        if (recipient == address(0)) revert ZeroAddress();
        accrueFees();
        feeRecipient = recipient;
        emit FeeRecipientUpdated(recipient);
    }

    function setDescription(string calldata description_) external onlyOwner {
        description = description_;
        emit DescriptionUpdated(description_);
    }

    function setAgentAuthorization(address agent, bool authorized) external onlyOwner {
        authorizedAgents[agent] = authorized;
        emit AgentUpdated(agent, authorized);
    }

    /// @notice Manager or protocol guardian. Pausing stops deposits, cash redemptions and rebalancing;
    ///         in-kind redemptions stay open.
    function emergencyPause() external {
        if (msg.sender != owner() && msg.sender != _guardian()) revert NotGuardian();
        _pause();
    }

    function emergencyUnpause() external {
        if (msg.sender != owner() && msg.sender != _guardian()) revert NotGuardian();
        _unpause();
    }

    // ------------------------------------------------------------------ user

    /// @notice Deposit cash (the basket is bought at NAV) or a basket stock token (in kind).
    ///         Prefer depositWithMin: this version accepts any share amount.
    function deposit(address token, uint256 amount) external nonReentrant whenNotPaused returns (uint256 shares) {
        return _deposit(token, amount, 0);
    }

    /// @notice deposit() that reverts if fewer than `minSharesOut` shares would be minted (slippage / inflation guard).
    function depositWithMin(address token, uint256 amount, uint256 minSharesOut)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 shares)
    {
        return _deposit(token, amount, minSharesOut);
    }

    function _deposit(address token, uint256 amount, uint256 minSharesOut) internal returns (uint256 shares) {
        if (amount == 0) revert ZeroAmount();
        accrueFees();
        uint256 navBefore = getTotalValue();
        uint256 supply = totalSupply();
        uint256 valueUsd;

        if (token == address(cashToken)) {
            valueUsd = _cashToUsd(amount);
            cashToken.transferFrom(msg.sender, address(exchange), amount);
            exchange.burn(address(cashToken), amount);
            _buyBasket(valueUsd);
        } else {
            if (!assetInfo[token].active) revert UnsupportedToken(token);
            valueUsd = _tokenToUsd(token, amount);
            IB20Mintable(token).transferFrom(msg.sender, address(this), amount);
            _sync(token);
        }

        uint256 gross = (supply == 0 || navBefore == 0) ? valueUsd : (valueUsd * supply) / navBefore;
        if (supply == 0) {
            if (gross <= DEAD_SHARES) revert ZeroAmount();
            _mint(DEAD, DEAD_SHARES);
            gross -= DEAD_SHARES;
        }
        uint256 fee = (gross * fees.entryFeeBps) / BASIS_POINTS;
        shares = gross - fee;
        if (shares == 0) revert ZeroAmount();
        if (shares < minSharesOut) revert Slippage(shares, minSharesOut);
        _mint(msg.sender, shares);
        if (fee > 0) _payFee(address(0), fee, FeeKind.Entry);
        emit Deposited(msg.sender, token, amount, valueUsd, shares);
    }

    /// @notice Redeem shares. tokenOut == cash token: the basket is sold at NAV and paid in cash.
    ///         tokenOut == address(0): pro-rata in-kind transfer of every basket token (works while paused).
    function withdraw(uint256 shares, address tokenOut, uint256 minAmountOut)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        if (shares == 0) revert ZeroAmount();
        if (tokenOut != address(0)) _requireNotPaused();
        accrueFees();

        uint256 fee = (shares * fees.exitFeeBps) / BASIS_POINTS;
        if (fee > 0) _payFee(msg.sender, fee, FeeKind.Exit);
        uint256 net = shares - fee;
        uint256 supply = totalSupply();
        _burn(msg.sender, net);

        if (tokenOut == address(cashToken)) {
            uint256 valueUsd;
            for (uint256 i; i < assetList.length; ++i) {
                address t = assetList[i];
                uint256 part = (IB20Mintable(t).balanceOf(address(this)) * net) / supply;
                if (part == 0) continue;
                valueUsd += _tokenToUsd(t, part);
                _sell(t, part);
            }
            amountOut = _usdToCash(valueUsd);
            if (amountOut < minAmountOut) revert Slippage(amountOut, minAmountOut);
            if (amountOut > 0) exchange.mint(address(cashToken), msg.sender, amountOut);
        } else if (tokenOut == address(0)) {
            for (uint256 i; i < assetList.length; ++i) {
                address t = assetList[i];
                uint256 part = (IB20Mintable(t).balanceOf(address(this)) * net) / supply;
                if (part == 0) continue;
                IB20Mintable(t).transfer(msg.sender, part);
                _sync(t);
                amountOut += part;
            }
            if (amountOut < minAmountOut) revert Slippage(amountOut, minAmountOut);
        } else {
            revert UnsupportedToken(tokenOut);
        }
        emit Withdrawn(msg.sender, tokenOut, shares, amountOut);
    }

    /// @notice Bring every holding back to target weight at current NAV (buy under-weight, sell over-weight).
    function rebalance() external onlyAgent whenNotPaused {
        accrueFees();
        uint256 total = getTotalValue();
        for (uint256 i; i < assetList.length; ++i) {
            address t = assetList[i];
            Asset storage a = assetInfo[t];
            uint256 targetUsd = a.active ? (total * a.targetWeight) / BASIS_POINTS : 0;
            uint256 targetBal = _usdToToken(t, targetUsd);
            uint256 bal = IB20Mintable(t).balanceOf(address(this));
            if (targetBal > bal) exchange.mint(t, address(this), targetBal - bal);
            else if (bal > targetBal) _sell(t, bal - targetBal);
            _sync(t);
        }
        lastRebalanceTime = block.timestamp;
        emit Rebalanced(total);
    }

    /// @notice Mints the management fee accrued since the last accrual. Anyone can call it.
    function accrueFees() public {
        uint256 shares = previewAccruedFeeShares();
        lastFeeAccrual = block.timestamp;
        if (shares > 0) _payFee(address(0), shares, FeeKind.Management);
    }

    function updateAssetBalance(address token) external {
        if (assetInfo[token].token == address(0)) revert UnknownAsset(token);
        _sync(token);
    }

    // ------------------------------------------------------------------ views

    /// @notice Management-fee shares that `accrueFees()` would mint now.
    ///         Dilution formula: new = supply * r*dt / (YEAR*BPS - r*dt), so the fee is exactly r*dt/YEAR of AUM.
    function previewAccruedFeeShares() public view returns (uint256) {
        uint256 supply = totalSupply();
        uint256 dt = block.timestamp - lastFeeAccrual;
        if (supply == 0 || dt == 0 || fees.managementFeeBps == 0) return 0;
        uint256 d = BASIS_POINTS * YEAR;
        uint256 x = uint256(fees.managementFeeBps) * dt;
        if (x * 2 > d) x = d / 2;
        return (supply * x) / (d - x);
    }

    function protocolFeeBps() public view returns (uint256) {
        return factory == address(0) ? 0 : IETFFactory(factory).protocolFeeBps();
    }

    function getActiveAssets() external view returns (address[] memory activeAssets) {
        uint256 n;
        for (uint256 i; i < assetList.length; ++i) if (assetInfo[assetList[i]].active) ++n;
        activeAssets = new address[](n);
        uint256 j;
        for (uint256 i; i < assetList.length; ++i) if (assetInfo[assetList[i]].active) activeAssets[j++] = assetList[i];
    }

    function getAsset(address token) external view returns (Asset memory asset) {
        asset = assetInfo[token];
        asset.balance = asset.token == address(0) ? 0 : IB20Mintable(token).balanceOf(address(this));
    }

    function getHoldings() external view returns (AssetView[] memory out) {
        out = new AssetView[](assetList.length);
        for (uint256 i; i < assetList.length; ++i) {
            address t = assetList[i];
            uint256 bal = IB20Mintable(t).balanceOf(address(this));
            uint256 p = exchange.price(t);
            out[i] = AssetView(
                t,
                assetInfo[t].targetWeight,
                bal,
                p,
                exchange.priceUpdatedAt(t),
                p == 0 ? 0 : _tokenToUsdUnchecked(t, bal),
                IB20Mintable(t).decimals()
            );
        }
    }

    function getTotalTargetWeight() public view returns (uint256 total) {
        for (uint256 i; i < assetList.length; ++i) {
            if (assetInfo[assetList[i]].active) total += assetInfo[assetList[i]].targetWeight;
        }
    }

    /// @notice Total USD value of holdings, 18 decimals. Uses last pushed prices (no staleness revert).
    function getTotalValue() public view returns (uint256 totalValue) {
        for (uint256 i; i < assetList.length; ++i) {
            address t = assetList[i];
            uint256 bal = IB20Mintable(t).balanceOf(address(this));
            if (bal > 0 && exchange.price(t) > 0) totalValue += _tokenToUsdUnchecked(t, bal);
        }
    }

    /// @notice USD value per share, 18 decimals (1e18 = $1.00 before any deposit).
    function getNetAssetValue() external view returns (uint256 nav) {
        uint256 supply = totalSupply();
        nav = supply == 0 ? 1e18 : (getTotalValue() * 1e18) / supply;
    }

    function totalValueLocked() external view returns (uint256) {
        return getTotalValue();
    }

    function assetCount() external view returns (uint256) {
        return assetList.length;
    }

    // Compatibility with the previous single-vault ABI (prices now live on the shared exchange).
    function price(address token) external view returns (uint256) {
        return exchange.price(token);
    }

    function priceUpdatedAt(address token) external view returns (uint256) {
        return exchange.priceUpdatedAt(token);
    }

    function maxPriceAge() external view returns (uint256) {
        return exchange.maxPriceAge();
    }

    // ------------------------------------------------------------------ internal

    function _addAsset(address token, uint256 targetWeight) internal {
        if (assetInfo[token].active) revert AssetExists(token);
        if (token == address(cashToken) || !exchange.isListed(token)) revert UnsupportedToken(token);
        if (assetInfo[token].token == address(0)) {
            if (assetList.length >= MAX_ASSETS) revert TooManyAssets();
            assetList.push(token);
        }
        assetInfo[token] = Asset(token, targetWeight, IB20Mintable(token).balanceOf(address(this)), true);
        if (getTotalTargetWeight() > BASIS_POINTS) revert BadWeights(getTotalTargetWeight());
        emit AssetAdded(token, targetWeight);
    }

    function _validateFees(Fees memory f) internal pure {
        if (
            f.managementFeeBps > MAX_MANAGEMENT_FEE_BPS || f.entryFeeBps > MAX_ENTRY_FEE_BPS
                || f.exitFeeBps > MAX_EXIT_FEE_BPS
        ) revert FeeTooHigh();
    }

    function _applyFees(Fees memory f) internal {
        _validateFees(f);
        fees = f;
        emit FeesUpdated(f.managementFeeBps, f.entryFeeBps, f.exitFeeBps);
    }

    /// @dev from == 0 mints new shares (management, entry); otherwise moves `shares` out of `from` (exit).
    function _payFee(address from, uint256 shares, FeeKind kind) internal {
        uint256 supplyAfter = from == address(0) ? totalSupply() + shares : totalSupply();
        uint256 valueUsd = supplyAfter == 0 ? 0 : (shares * getTotalValue()) / supplyAfter;

        address treasury = factory == address(0) ? address(0) : IETFFactory(factory).treasury();
        uint256 protocolShares = treasury == address(0) ? 0 : (shares * protocolFeeBps()) / BASIS_POINTS;
        uint256 managerShares = shares - protocolShares;
        uint256 protocolUsd = shares == 0 ? 0 : (valueUsd * protocolShares) / shares;

        if (from == address(0)) {
            if (managerShares > 0) _mint(feeRecipient, managerShares);
            if (protocolShares > 0) _mint(treasury, protocolShares);
        } else {
            if (managerShares > 0) _transfer(from, feeRecipient, managerShares);
            if (protocolShares > 0) _transfer(from, treasury, protocolShares);
        }
        managerFeeShares += managerShares;
        protocolFeeShares += protocolShares;
        managerFeesUsd += valueUsd - protocolUsd;
        protocolFeesUsd += protocolUsd;
        emit FeesPaid(kind, managerShares, protocolShares, valueUsd);
    }

    function _guardian() internal view returns (address) {
        return factory == address(0) ? address(0) : IETFFactory(factory).owner();
    }

    function _buyBasket(uint256 valueUsd) internal {
        uint256 total = getTotalTargetWeight();
        if (total != BASIS_POINTS) revert BadWeights(total);
        for (uint256 i; i < assetList.length; ++i) {
            address t = assetList[i];
            Asset storage a = assetInfo[t];
            if (!a.active || a.targetWeight == 0) continue;
            uint256 amt = _usdToToken(t, (valueUsd * a.targetWeight) / BASIS_POINTS);
            if (amt > 0) exchange.mint(t, address(this), amt);
            _sync(t);
        }
    }

    function _sell(address token, uint256 amount) internal {
        IB20Mintable(token).transfer(address(exchange), amount);
        exchange.burn(token, amount);
        _sync(token);
    }

    function _sync(address token) internal {
        assetInfo[token].balance = IB20Mintable(token).balanceOf(address(this));
    }

    // value(18d) = amount * price(8d) * 1e18 / (10^dec * 1e8)
    function _tokenToUsd(address token, uint256 amount) internal view returns (uint256) {
        uint256 p = exchange.checkedPrice(token);
        return (amount * p * 1e10) / (10 ** IB20Mintable(token).decimals());
    }

    function _tokenToUsdUnchecked(address token, uint256 amount) internal view returns (uint256) {
        return (amount * exchange.price(token) * 1e10) / (10 ** IB20Mintable(token).decimals());
    }

    function _usdToToken(address token, uint256 usd) internal view returns (uint256) {
        uint256 p = exchange.checkedPrice(token);
        return (usd * (10 ** IB20Mintable(token).decimals())) / (p * 1e10);
    }

    function _cashToUsd(uint256 amount) internal view returns (uint256) {
        return amount * 10 ** (18 - cashDecimals);
    }

    function _usdToCash(uint256 usd) internal view returns (uint256) {
        return usd / 10 ** (18 - cashDecimals);
    }
}
