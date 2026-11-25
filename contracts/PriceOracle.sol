// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {AggregatorV3Interface, IPriceOracle} from "./Interfaces.sol";

/// @title PriceOracle
/// @notice The one NAV price source and asset registry shared by every ETF on the platform.
///
///         Each listed token is priced by either:
///         - a Chainlink-style feed (`setFeed`), checked against a per-feed heartbeat. Use this on mainnet.
///         - a price pushed by an authorized agent (`setPrices`), checked against `maxPriceAge`. Each agent
///           update may move a fresh price by at most `maxDeviationBps`; only the owner can push past it.
///         A feed always wins over a pushed price.
///
///         `checkedPrice` is what vaults trade on. It reverts when the price is missing or stale, and,
///         when a sequencer uptime feed is set, while the L2 sequencer is down or within the grace period
///         after it comes back. Stale prices therefore stop deposits, cash redemptions and rebalances
///         (in-kind redemption needs no price and keeps working).
/// @dev Prices are USD with 8 decimals per whole token.
contract PriceOracle is Ownable2Step, IPriceOracle {
    struct Feed {
        address aggregator;
        uint32 heartbeat; // max seconds between feed updates before the price counts as stale
    }

    uint256 public constant PRICE_DECIMALS = 8;
    uint256 public constant SEQUENCER_GRACE_PERIOD = 1 hours;

    address public immutable cashToken;

    mapping(address => bool) public isListed;
    address[] internal listedTokens;
    mapping(address => bool) internal everListed;

    mapping(address => Feed) public feeds;
    mapping(address => uint256) internal pushedPrice;
    mapping(address => uint256) internal pushedAt;

    mapping(address => bool) public authorizedAgents;
    uint256 public maxPriceAge;
    uint256 public maxDeviationBps; // 0 = unbounded
    address public sequencerUptimeFeed; // 0 = no check (e.g. testnet)

    event Listed(address indexed token, bool listed);
    event PricesUpdated(address[] tokens, uint256[] prices);
    event FeedUpdated(address indexed token, address aggregator, uint32 heartbeat);
    event AgentUpdated(address indexed agent, bool authorized);
    event MaxPriceAgeUpdated(uint256 age);
    event MaxDeviationUpdated(uint256 bps);
    event SequencerFeedUpdated(address feed);

    error NotAgent();
    error NotListable(address token);
    error LengthMismatch();
    error ZeroPrice();
    error BadConfig();
    error DeviationTooHigh(address token, uint256 previous, uint256 next);
    error StalePrice(address token);
    error SequencerDown();

    modifier onlyAgent() {
        if (msg.sender != owner() && !authorizedAgents[msg.sender]) revert NotAgent();
        _;
    }

    constructor(address cashToken_, address agent_, address owner_, uint256 maxPriceAge_, uint256 maxDeviationBps_)
        Ownable(owner_)
    {
        if (cashToken_ == address(0) || maxPriceAge_ == 0) revert BadConfig();
        cashToken = cashToken_;
        maxPriceAge = maxPriceAge_;
        maxDeviationBps = maxDeviationBps_;
        if (agent_ != address(0)) {
            authorizedAgents[agent_] = true;
            emit AgentUpdated(agent_, true);
        }
    }

    // ------------------------------------------------------------------ admin

    function setListed(address[] calldata tokens, bool listed) external onlyOwner {
        for (uint256 i; i < tokens.length; ++i) {
            address t = tokens[i];
            if (t == cashToken || t == address(0)) revert NotListable(t);
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

    function setMaxPriceAge(uint256 age) external onlyOwner {
        if (age == 0) revert BadConfig();
        maxPriceAge = age;
        emit MaxPriceAgeUpdated(age);
    }

    function setMaxDeviationBps(uint256 bps) external onlyOwner {
        maxDeviationBps = bps;
        emit MaxDeviationUpdated(bps);
    }

    /// @notice aggregator == 0 removes the feed (the token falls back to pushed prices).
    function setFeed(address token, address aggregator, uint32 heartbeat) external onlyOwner {
        if (aggregator != address(0) && heartbeat == 0) revert BadConfig();
        feeds[token] = Feed(aggregator, heartbeat);
        emit FeedUpdated(token, aggregator, heartbeat);
    }

    /// @notice Chainlink L2 sequencer uptime feed (answer 0 = up, 1 = down). 0 disables the check.
    function setSequencerUptimeFeed(address feed) external onlyOwner {
        sequencerUptimeFeed = feed;
        emit SequencerFeedUpdated(feed);
    }

    /// @notice Push prices for tokens without a feed. Agents are bounded by maxDeviationBps against a
    ///         still-fresh previous price; the owner is not (for repricing after a halt or a corporate action).
    function setPrices(address[] calldata tokens, uint256[] calldata prices) external onlyAgent {
        if (tokens.length != prices.length) revert LengthMismatch();
        bool bounded = msg.sender != owner() && maxDeviationBps != 0;
        for (uint256 i; i < tokens.length; ++i) {
            address t = tokens[i];
            uint256 p = prices[i];
            if (p == 0) revert ZeroPrice();
            uint256 prev = pushedPrice[t];
            if (bounded && prev != 0 && block.timestamp - pushedAt[t] <= maxPriceAge) {
                uint256 diff = p > prev ? p - prev : prev - p;
                if (diff * 10_000 > prev * maxDeviationBps) revert DeviationTooHigh(t, prev, p);
            }
            pushedPrice[t] = p;
            pushedAt[t] = block.timestamp;
        }
        emit PricesUpdated(tokens, prices);
    }

    // ------------------------------------------------------------------ views

    /// @notice Latest price (8 decimals), unchecked. 0 if none.
    function price(address token) public view returns (uint256) {
        (uint256 p,) = _read(token);
        return p;
    }

    function priceUpdatedAt(address token) public view returns (uint256) {
        (, uint256 at) = _read(token);
        return at;
    }

    /// @notice Staleness limit that applies to `token` (its feed heartbeat, else maxPriceAge).
    function maxAgeOf(address token) public view returns (uint256) {
        Feed memory f = feeds[token];
        return f.aggregator == address(0) ? maxPriceAge : f.heartbeat;
    }

    function checkedPrice(address token) external view returns (uint256 p) {
        _checkSequencer();
        uint256 at;
        (p, at) = _read(token);
        if (p == 0 || at > block.timestamp || block.timestamp - at > maxAgeOf(token)) revert StalePrice(token);
    }

    function getListedTokens() external view returns (address[] memory out) {
        uint256 n;
        for (uint256 i; i < listedTokens.length; ++i) if (isListed[listedTokens[i]]) ++n;
        out = new address[](n);
        uint256 j;
        for (uint256 i; i < listedTokens.length; ++i) if (isListed[listedTokens[i]]) out[j++] = listedTokens[i];
    }

    // ------------------------------------------------------------------ internal

    function _read(address token) internal view returns (uint256 p, uint256 at) {
        Feed memory f = feeds[token];
        if (f.aggregator == address(0)) return (pushedPrice[token], pushedAt[token]);
        try AggregatorV3Interface(f.aggregator).latestRoundData() returns (
            uint80, int256 answer, uint256, uint256 updatedAt, uint80
        ) {
            if (answer <= 0) return (0, updatedAt);
            uint8 d = AggregatorV3Interface(f.aggregator).decimals();
            uint256 a = uint256(answer);
            p = d >= PRICE_DECIMALS ? a / 10 ** (d - PRICE_DECIMALS) : a * 10 ** (PRICE_DECIMALS - d);
            at = updatedAt;
        } catch {
            return (0, 0);
        }
    }

    function _checkSequencer() internal view {
        address feed = sequencerUptimeFeed;
        if (feed == address(0)) return;
        (, int256 answer, uint256 startedAt,,) = AggregatorV3Interface(feed).latestRoundData();
        if (answer != 0 || startedAt == 0 || block.timestamp - startedAt <= SEQUENCER_GRACE_PERIOD) revert SequencerDown();
    }
}
