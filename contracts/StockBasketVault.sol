// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IETFFactory, IPriceOracle, ISanctionsList, IVenue} from "./Interfaces.sol";

/// @title StockBasketVault
/// @notice A user-created tokenized-stock ETF. Each vault is an EIP-1167 clone made by ETFFactory; the
///         creator is the vault's owner (the "manager"), who picks the basket and earns fees for running it.
///
///         Money flow: deposits of the cash token are swapped into the basket through the factory's venue;
///         cash redemptions sell the holder's pro-rata slice back to cash. Every trade must fill within the
///         factory's slippage cap of the oracle price, and the depositor (or redeemer) bears the actual
///         execution cost, never the other holders: shares are minted for the NAV the deposit actually added.
///
///         NAV comes from internally tracked balances (`Asset.balance`, `cashBalance`), never from
///         `balanceOf`, so tokens sent straight to the vault cannot move the share price. Value-changing
///         actions price everything with `checkedPrice`, so a missing or stale price reverts the action.
///
///         Fees (paid as vault shares, so they track the ETF's value):
///         - management fee: annual rate, streamed by diluting supply (max 5%/yr)
///         - entry fee: % of each deposit (max 1%)
///         - exit fee: % of each redemption (max 1%)
///         The protocol takes `protocolFeeBps` of every fee (set on the factory, capped at 30%).
///
///         Holder protections:
///         - fee increases wait FEE_TIMELOCK; decreases apply at once
///         - basket changes wait BASKET_TIMELOCK once the ETF has holders
///         - rebalances are at most once per MIN_REBALANCE_INTERVAL and slippage-bounded
///         - in-kind redemption works while paused and while prices are stale
/// @dev Share token and all USD values returned by views use 18 decimals.
contract StockBasketVault is ERC20, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Asset {
        address token;
        uint256 targetWeight; // basis points
        uint256 balance; // accounted balance of the token (raw units)
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
    uint256 public constant BASKET_TIMELOCK = 1 days;
    uint256 public constant MIN_REBALANCE_INTERVAL = 12 hours;
    uint256 public constant MIN_TRADE_USD = 1e18; // rebalances skip trades under $1

    bool private _initialized;
    string private _name;
    string private _symbol;
    string public description;

    IETFFactory public factory;
    IPriceOracle public oracle;
    IVenue public venue;
    IERC20 public cashToken;
    uint8 public cashDecimals;
    uint256 public cashBalance; // accounted cash (rounding leftovers and rebalance proceeds)

    mapping(address => bool) public authorizedAgents;

    address[] internal assetList;
    mapping(address => Asset) internal assetInfo;
    uint256 public lastRebalanceTime;
    uint256 public createdAt;

    // basket changes
    address[] internal pendingTokens;
    uint256[] internal pendingWeights;
    uint256 public pendingBasketEta; // 0 = nothing queued

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
    event BasketUpdated(address[] tokens, uint256[] weights);
    event BasketQueued(address[] tokens, uint256[] weights, uint256 eta);
    event BasketCancelled();
    event Deposited(address indexed user, address indexed token, uint256 amount, uint256 valueUsd, uint256 shares);
    event Withdrawn(address indexed user, address indexed tokenOut, uint256 shares, uint256 amountOut);
    event Traded(address indexed token, bool buy, uint256 amountIn, uint256 amountOut);
    event Rebalanced(uint256 totalValueUsd);
    event AgentUpdated(address indexed agent, bool authorized);
    event FeesPaid(FeeKind indexed kind, uint256 managerShares, uint256 protocolShares, uint256 valueUsd);
    event FeesQueued(uint16 managementFeeBps, uint16 entryFeeBps, uint16 exitFeeBps, uint256 eta);
    event FeesUpdated(uint16 managementFeeBps, uint16 entryFeeBps, uint16 exitFeeBps);
    event FeeRecipientUpdated(address indexed recipient);
    event DescriptionUpdated(string description);
    event Swept(address indexed token, address indexed to, uint256 amount);

    error AlreadyInitialized();
    error NotAgent();
    error NotGuardian();
    error UnknownAsset(address token);
    error DuplicateAsset(address token);
    error TooManyAssets();
    error BadWeights(uint256 total);
    error LengthMismatch();
    error ZeroAmount();
    error ZeroAddress();
    error ZeroNav();
    error Slippage(uint256 out, uint256 minOut);
    error UnsupportedToken(address token);
    error FeeTooHigh();
    error FeesNotReady();
    error BasketNotReady();
    error BadName();
    error RebalanceTooSoon(uint256 nextAllowed);
    error TvlCapExceeded(uint256 navAfter, uint256 cap);
    error Sanctioned(address account);
    error NothingToSweep();

    modifier onlyAgent() {
        if (msg.sender != owner() && !authorizedAgents[msg.sender]) revert NotAgent();
        _;
    }

    /// @dev The implementation contract is locked; clones start uninitialized (all storage zero).
    constructor() ERC20("", "") Ownable(address(0xdead)) {
        _initialized = true;
    }

    /// @notice Called once by the factory that cloned this vault. Oracle, venue and cash token come from it.
    function initialize(InitParams calldata p) external {
        if (_initialized) revert AlreadyInitialized();
        _initialized = true;
        if (p.manager == address(0)) revert ZeroAddress();
        if (bytes(p.name).length == 0 || bytes(p.name).length > 64) revert BadName();
        if (bytes(p.symbol).length == 0 || bytes(p.symbol).length > 12) revert BadName();

        _name = p.name;
        _symbol = p.symbol;
        description = p.description;
        factory = IETFFactory(msg.sender);
        oracle = IPriceOracle(factory.oracle());
        venue = IVenue(factory.venue());
        cashToken = IERC20(factory.cashToken());
        cashDecimals = IERC20Metadata(address(cashToken)).decimals();
        feeRecipient = p.feeRecipient == address(0) ? p.manager : p.feeRecipient;
        createdAt = block.timestamp;
        lastFeeAccrual = block.timestamp;
        _transferOwnership(p.manager);

        if (p.agent != address(0)) {
            authorizedAgents[p.agent] = true;
            emit AgentUpdated(p.agent, true);
        }
        _setBasket(p.tokens, p.weights);
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

    /// @notice Replace the whole basket: `tokens` with `weights` (bps, summing to 10,000). Assets left out
    ///         get weight 0 and are sold on the next rebalance. Applies at once while the ETF has no
    ///         holders; otherwise it is queued for BASKET_TIMELOCK so holders can exit first.
    function queueBasket(address[] calldata tokens, uint256[] calldata weights) external onlyOwner {
        _validateBasket(tokens, weights);
        if (totalSupply() == 0) {
            _clearPendingBasket();
            _setBasket(tokens, weights);
            return;
        }
        pendingTokens = tokens;
        pendingWeights = weights;
        pendingBasketEta = block.timestamp + BASKET_TIMELOCK;
        emit BasketQueued(tokens, weights, pendingBasketEta);
    }

    /// @notice Anyone can activate a queued basket once the timelock has passed.
    function applyPendingBasket() external {
        if (pendingBasketEta == 0 || block.timestamp < pendingBasketEta) revert BasketNotReady();
        address[] memory tokens = pendingTokens;
        uint256[] memory weights = pendingWeights;
        _clearPendingBasket();
        _setBasket(tokens, weights);
    }

    function cancelPendingBasket() external onlyOwner {
        _clearPendingBasket();
        emit BasketCancelled();
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

    /// @notice Recover tokens sent to the vault by mistake: only the amount above what the vault accounts for.
    function sweep(address token, address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        uint256 bal = IERC20(token).balanceOf(address(this));
        uint256 accounted = token == address(cashToken) ? cashBalance : assetInfo[token].balance;
        if (bal <= accounted) revert NothingToSweep();
        IERC20(token).safeTransfer(to, bal - accounted);
        emit Swept(token, to, bal - accounted);
    }

    /// @notice Manager or protocol guardian (factory owner). Pausing stops deposits, cash redemptions and
    ///         rebalancing; in-kind redemptions stay open.
    function emergencyPause() external {
        if (msg.sender != owner() && msg.sender != _guardian()) revert NotGuardian();
        _pause();
    }

    function emergencyUnpause() external {
        if (msg.sender != owner() && msg.sender != _guardian()) revert NotGuardian();
        _unpause();
    }

    // ------------------------------------------------------------------ user

    /// @notice Deposit cash (swapped into the basket through the venue) or a basket stock token (in kind).
    /// @param minShares Revert unless at least this many shares are minted (protects against slippage).
    function deposit(address token, uint256 amount, uint256 minShares)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 shares)
    {
        if (amount == 0) revert ZeroAmount();
        _checkSanctions(msg.sender);
        accrueFees();
        uint256 supply = totalSupply();
        uint256 navBefore = _checkedTotalValue();
        if (supply > 0 && navBefore == 0) revert ZeroNav();

        if (token == address(cashToken)) {
            uint256 received = _pull(cashToken, amount);
            cashBalance += received;
            _buyBasket(received);
        } else {
            if (!assetInfo[token].active) revert UnsupportedToken(token);
            assetInfo[token].balance += _pull(IERC20(token), amount);
        }

        uint256 navAfter = _checkedTotalValue();
        if (navAfter <= navBefore) revert ZeroAmount();
        uint256 cap = factory.tvlCapUsd();
        if (cap != 0 && navAfter > cap) revert TvlCapExceeded(navAfter, cap);
        uint256 valueUsd = navAfter - navBefore;

        uint256 gross = supply == 0 ? valueUsd : (valueUsd * supply) / navBefore;
        uint256 fee = (gross * fees.entryFeeBps) / BASIS_POINTS;
        shares = gross - fee;
        if (shares == 0) revert ZeroAmount();
        if (shares < minShares) revert Slippage(shares, minShares);
        _mint(msg.sender, shares);
        if (fee > 0) _payFee(address(0), fee, FeeKind.Entry);
        emit Deposited(msg.sender, token, amount, valueUsd, shares);
    }

    /// @notice Redeem shares. tokenOut == cash token: the holder's slice is sold through the venue and paid
    ///         in cash. tokenOut == address(0): pro-rata in-kind transfer of every holding (works while paused
    ///         and with stale prices).
    function withdraw(uint256 shares, address tokenOut, uint256 minAmountOut)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        if (shares == 0) revert ZeroAmount();
        if (tokenOut != address(0)) _requireNotPaused();
        _checkSanctions(msg.sender);
        accrueFees();

        uint256 fee = (shares * fees.exitFeeBps) / BASIS_POINTS;
        if (fee > 0) _payFee(msg.sender, fee, FeeKind.Exit);
        uint256 net = shares - fee;
        uint256 supply = totalSupply();
        _burn(msg.sender, net);
        uint256 cashPart = (cashBalance * net) / supply;

        if (tokenOut == address(cashToken)) {
            for (uint256 i; i < assetList.length; ++i) {
                address t = assetList[i];
                uint256 part = (assetInfo[t].balance * net) / supply;
                if (part > 0) cashPart += _sell(t, part);
            }
            amountOut = cashPart;
            if (amountOut < minAmountOut) revert Slippage(amountOut, minAmountOut);
            cashBalance -= amountOut;
            if (amountOut > 0) cashToken.safeTransfer(msg.sender, amountOut);
        } else if (tokenOut == address(0)) {
            for (uint256 i; i < assetList.length; ++i) {
                address t = assetList[i];
                uint256 part = (assetInfo[t].balance * net) / supply;
                if (part == 0) continue;
                assetInfo[t].balance -= part;
                IERC20(t).safeTransfer(msg.sender, part);
                amountOut += part;
            }
            if (amountOut < minAmountOut) revert Slippage(amountOut, minAmountOut);
            if (cashPart > 0) {
                cashBalance -= cashPart;
                cashToken.safeTransfer(msg.sender, cashPart);
            }
        } else {
            revert UnsupportedToken(tokenOut);
        }
        emit Withdrawn(msg.sender, tokenOut, shares, amountOut);
    }

    /// @notice Bring holdings back to target weight: sell over-weight assets, then spend the cash on
    ///         under-weight ones. At most once per MIN_REBALANCE_INTERVAL; every trade is slippage-bounded.
    function rebalance() external onlyAgent whenNotPaused nonReentrant {
        uint256 next = lastRebalanceTime + MIN_REBALANCE_INTERVAL;
        if (lastRebalanceTime != 0 && block.timestamp < next) revert RebalanceTooSoon(next);
        accrueFees();
        uint256 total = _checkedTotalValue();
        uint256 n = assetList.length;

        for (uint256 i; i < n; ++i) {
            address t = assetList[i];
            Asset storage a = assetInfo[t];
            uint256 targetUsd = a.active ? (total * a.targetWeight) / BASIS_POINTS : 0;
            uint256 valueUsd = _tokenToUsd(t, a.balance);
            if (valueUsd <= targetUsd) continue;
            // sell everything of a removed asset, even below MIN_TRADE_USD
            if (a.active && valueUsd - targetUsd < MIN_TRADE_USD) continue;
            uint256 keep = _usdToToken(t, targetUsd);
            if (a.balance > keep) _sell(t, a.balance - keep);
        }

        uint256[] memory need = new uint256[](n);
        uint256 totalNeed;
        for (uint256 i; i < n; ++i) {
            Asset storage a = assetInfo[assetList[i]];
            if (!a.active) continue;
            uint256 targetUsd = (total * a.targetWeight) / BASIS_POINTS;
            uint256 valueUsd = _tokenToUsd(a.token, a.balance);
            if (targetUsd > valueUsd + MIN_TRADE_USD) {
                need[i] = targetUsd - valueUsd;
                totalNeed += need[i];
            }
        }
        uint256 avail = _cashToUsd(cashBalance);
        for (uint256 i; i < n; ++i) {
            if (need[i] == 0) continue;
            uint256 usd = totalNeed > avail ? (need[i] * avail) / totalNeed : need[i];
            uint256 cashIn = _usdToCash(usd);
            if (cashIn > 0) _buy(assetList[i], cashIn);
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
        return factory.protocolFeeBps();
    }

    function getActiveAssets() external view returns (address[] memory activeAssets) {
        uint256 n;
        for (uint256 i; i < assetList.length; ++i) if (assetInfo[assetList[i]].active) ++n;
        activeAssets = new address[](n);
        uint256 j;
        for (uint256 i; i < assetList.length; ++i) if (assetInfo[assetList[i]].active) activeAssets[j++] = assetList[i];
    }

    function getAsset(address token) external view returns (Asset memory) {
        return assetInfo[token];
    }

    function getPendingBasket() external view returns (address[] memory tokens, uint256[] memory weights, uint256 eta) {
        return (pendingTokens, pendingWeights, pendingBasketEta);
    }

    function getHoldings() external view returns (AssetView[] memory out) {
        out = new AssetView[](assetList.length);
        for (uint256 i; i < assetList.length; ++i) {
            address t = assetList[i];
            Asset storage a = assetInfo[t];
            uint256 p = oracle.price(t);
            out[i] = AssetView(
                t,
                a.targetWeight,
                a.balance,
                p,
                oracle.priceUpdatedAt(t),
                p == 0 ? 0 : _toUsd(t, a.balance, p),
                IERC20Metadata(t).decimals()
            );
        }
    }

    function getTotalTargetWeight() public view returns (uint256 total) {
        for (uint256 i; i < assetList.length; ++i) {
            if (assetInfo[assetList[i]].active) total += assetInfo[assetList[i]].targetWeight;
        }
    }

    /// @notice Total USD value (18 decimals) at the last known prices, without staleness checks. For display;
    ///         value-changing actions use the checked equivalent.
    function getTotalValue() public view returns (uint256 totalValue) {
        totalValue = _cashToUsd(cashBalance);
        for (uint256 i; i < assetList.length; ++i) {
            address t = assetList[i];
            uint256 bal = assetInfo[t].balance;
            uint256 p = oracle.price(t);
            if (bal > 0 && p > 0) totalValue += _toUsd(t, bal, p);
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

    function price(address token) external view returns (uint256) {
        return oracle.price(token);
    }

    function priceUpdatedAt(address token) external view returns (uint256) {
        return oracle.priceUpdatedAt(token);
    }

    function maxPriceAge() external view returns (uint256) {
        return oracle.maxPriceAge();
    }

    // ------------------------------------------------------------------ internal: basket

    function _validateBasket(address[] memory tokens, uint256[] memory weights) internal view {
        if (tokens.length != weights.length) revert LengthMismatch();
        if (tokens.length == 0 || tokens.length > MAX_ASSETS) revert TooManyAssets();
        uint256 total;
        for (uint256 i; i < tokens.length; ++i) {
            address t = tokens[i];
            if (t == address(0) || t == address(cashToken) || !oracle.isListed(t)) revert UnsupportedToken(t);
            if (weights[i] == 0) revert BadWeights(0);
            for (uint256 j; j < i; ++j) if (tokens[j] == t) revert DuplicateAsset(t);
            total += weights[i];
        }
        if (total != BASIS_POINTS) revert BadWeights(total);
    }

    function _setBasket(address[] memory tokens, uint256[] memory weights) internal {
        _validateBasket(tokens, weights);
        for (uint256 i; i < assetList.length; ++i) {
            Asset storage a = assetInfo[assetList[i]];
            a.active = false;
            a.targetWeight = 0;
        }
        for (uint256 i; i < tokens.length; ++i) {
            Asset storage a = assetInfo[tokens[i]];
            if (a.token == address(0)) {
                a.token = tokens[i];
                assetList.push(tokens[i]);
            }
            a.active = true;
            a.targetWeight = weights[i];
        }
        // drop removed assets the vault no longer holds
        uint256 k;
        while (k < assetList.length) {
            Asset storage a = assetInfo[assetList[k]];
            if (!a.active && a.balance == 0) {
                delete assetInfo[assetList[k]];
                assetList[k] = assetList[assetList.length - 1];
                assetList.pop();
            } else {
                ++k;
            }
        }
        if (assetList.length > MAX_ASSETS) revert TooManyAssets();
        emit BasketUpdated(tokens, weights);
    }

    function _clearPendingBasket() internal {
        delete pendingTokens;
        delete pendingWeights;
        pendingBasketEta = 0;
    }

    // ------------------------------------------------------------------ internal: trading

    function _buyBasket(uint256 cashAmount) internal {
        for (uint256 i; i < assetList.length; ++i) {
            Asset storage a = assetInfo[assetList[i]];
            if (!a.active) continue;
            uint256 cashIn = (cashAmount * a.targetWeight) / BASIS_POINTS;
            if (cashIn > 0) _buy(a.token, cashIn);
        }
    }

    /// @dev Spend `cashIn` of accounted cash on `token`; fill must be within the slippage cap of the oracle price.
    function _buy(address token, uint256 cashIn) internal {
        uint256 expected = _usdToToken(token, _cashToUsd(cashIn));
        if (expected == 0) return;
        uint256 minOut = (expected * (BASIS_POINTS - factory.maxSlippageBps())) / BASIS_POINTS;
        IERC20 t = IERC20(token);
        uint256 tokBefore = t.balanceOf(address(this));
        uint256 cashBefore = cashToken.balanceOf(address(this));
        cashToken.forceApprove(address(venue), cashIn);
        venue.buy(token, cashIn, minOut);
        cashToken.forceApprove(address(venue), 0);
        uint256 got = t.balanceOf(address(this)) - tokBefore;
        uint256 spent = cashBefore - cashToken.balanceOf(address(this));
        if (got < minOut) revert Slippage(got, minOut);
        assetInfo[token].balance += got;
        cashBalance -= spent;
        emit Traded(token, true, spent, got);
    }

    /// @dev Sell `amount` of `token` for cash (added to cashBalance); returns the cash received.
    function _sell(address token, uint256 amount) internal returns (uint256 got) {
        uint256 expected = _usdToCash(_tokenToUsd(token, amount));
        uint256 minOut = (expected * (BASIS_POINTS - factory.maxSlippageBps())) / BASIS_POINTS;
        IERC20 t = IERC20(token);
        uint256 tokBefore = t.balanceOf(address(this));
        uint256 cashBefore = cashToken.balanceOf(address(this));
        t.forceApprove(address(venue), amount);
        venue.sell(token, amount, minOut);
        t.forceApprove(address(venue), 0);
        uint256 sent = tokBefore - t.balanceOf(address(this));
        got = cashToken.balanceOf(address(this)) - cashBefore;
        if (got < minOut) revert Slippage(got, minOut);
        assetInfo[token].balance -= sent;
        cashBalance += got;
        emit Traded(token, false, sent, got);
    }

    function _pull(IERC20 token, uint256 amount) internal returns (uint256 received) {
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        received = token.balanceOf(address(this)) - before;
    }

    // ------------------------------------------------------------------ internal: fees, guards

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

        address treasury = factory.treasury();
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
        return factory.owner();
    }

    function _checkSanctions(address account) internal view {
        address list = factory.sanctionsList();
        if (list != address(0) && ISanctionsList(list).isSanctioned(account)) revert Sanctioned(account);
    }

    /// @dev Share transfers between holders are blocked for sanctioned addresses (mints and burns are
    ///      checked at deposit and withdraw).
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            _checkSanctions(from);
            _checkSanctions(to);
        }
        super._update(from, to, value);
    }

    // ------------------------------------------------------------------ internal: math

    function _checkedTotalValue() internal view returns (uint256 total) {
        total = _cashToUsd(cashBalance);
        for (uint256 i; i < assetList.length; ++i) {
            address t = assetList[i];
            uint256 bal = assetInfo[t].balance;
            if (bal > 0) total += _tokenToUsd(t, bal);
        }
    }

    // value(18d) = amount * price(8d) * 1e18 / (10^dec * 1e8)
    function _toUsd(address token, uint256 amount, uint256 p) internal view returns (uint256) {
        return (amount * p * 1e10) / (10 ** IERC20Metadata(token).decimals());
    }

    function _tokenToUsd(address token, uint256 amount) internal view returns (uint256) {
        if (amount == 0) return 0;
        return _toUsd(token, amount, oracle.checkedPrice(token));
    }

    function _usdToToken(address token, uint256 usd) internal view returns (uint256) {
        if (usd == 0) return 0;
        return (usd * (10 ** IERC20Metadata(token).decimals())) / (oracle.checkedPrice(token) * 1e10);
    }

    function _cashToUsd(uint256 amount) internal view returns (uint256) {
        return amount * 10 ** (18 - cashDecimals);
    }

    function _usdToCash(uint256 usd) internal view returns (uint256) {
        return usd / 10 ** (18 - cashDecimals);
    }
}
