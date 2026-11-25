// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {PriceOracle} from "../contracts/PriceOracle.sol";
import {StockExchange} from "../contracts/StockExchange.sol";
import {StockBasketVault} from "../contracts/StockBasketVault.sol";
import {ETFFactory} from "../contracts/ETFFactory.sol";
import {IVenue} from "../contracts/Interfaces.sol";
import {MockToken} from "./mocks/Mocks.sol";

/// @dev Shared fixture: cash (6 dec), stock A (8 dec, $100), stock B (18 dec, $50), a 60/40 ETF.
abstract contract BaseTest is Test {
    address internal owner = makeAddr("owner");
    address internal agent = makeAddr("agent");
    address internal treasury = makeAddr("treasury");
    address internal manager = makeAddr("manager");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    MockToken internal cash;
    MockToken internal a;
    MockToken internal b;
    PriceOracle internal oracle;
    StockExchange internal exchange;
    ETFFactory internal factory;
    StockBasketVault internal vault;

    uint256 internal constant PRICE_A = 100e8;
    uint256 internal constant PRICE_B = 50e8;

    function setUp() public virtual {
        vm.warp(1_700_000_000);
        cash = new MockToken("USDC", 6);
        a = new MockToken("A", 8);
        b = new MockToken("B", 18);
        oracle = new PriceOracle(address(cash), agent, owner, 3 days, 2_000);
        exchange = new StockExchange(oracle, owner);
        factory = _newFactory(IVenue(address(exchange)), 100);
        vm.prank(owner);
        exchange.setFactory(address(factory));

        vm.startPrank(owner);
        oracle.setListed(_arr(address(a), address(b)), true);
        oracle.setPrices(_arr(address(a), address(b)), _arr(PRICE_A, PRICE_B));
        factory.setPermissionless(true);
        vm.stopPrank();

        vault = _createEtf(factory, _fees(0, 0, 0));
        _fund(alice, 100_000e6);
        _fund(bob, 100_000e6);
    }

    // ------------------------------------------------------------------ helpers

    function _newFactory(IVenue venue, uint256 slippageBps) internal returns (ETFFactory f) {
        StockBasketVault impl = new StockBasketVault();
        f = new ETFFactory(address(impl), address(oracle), address(venue), treasury, 2_000, agent, slippageBps, owner);
    }

    function _createEtf(ETFFactory f, StockBasketVault.Fees memory fees) internal returns (StockBasketVault v) {
        ETFFactory.CreateParams memory p = ETFFactory.CreateParams({
            name: "Test ETF",
            symbol: "tETF",
            description: "",
            feeRecipient: address(0),
            tokens: _arr(address(a), address(b)),
            weights: _arr(6_000, 4_000),
            fees: fees
        });
        vm.prank(manager);
        v = StockBasketVault(f.createETF(p));
    }

    function _fees(uint16 m, uint16 e, uint16 x) internal pure returns (StockBasketVault.Fees memory) {
        return StockBasketVault.Fees(m, e, x);
    }

    function _fund(address who, uint256 amount) internal {
        cash.mint(who, amount);
    }

    function _deposit(StockBasketVault v, address who, uint256 amount) internal returns (uint256) {
        vm.startPrank(who);
        cash.approve(address(v), amount);
        uint256 s = v.deposit(address(cash), amount, 0);
        vm.stopPrank();
        return s;
    }

    function _setPrices(uint256 pa, uint256 pb) internal {
        vm.prank(owner);
        oracle.setPrices(_arr(address(a), address(b)), _arr(pa, pb));
    }

    function _arr(address x, address y) internal pure returns (address[] memory r) {
        r = new address[](2);
        r[0] = x;
        r[1] = y;
    }

    function _arr(uint256 x, uint256 y) internal pure returns (uint256[] memory r) {
        r = new uint256[](2);
        r[0] = x;
        r[1] = y;
    }

    function _one(address x) internal pure returns (address[] memory r) {
        r = new address[](1);
        r[0] = x;
    }

    function _one(uint256 x) internal pure returns (uint256[] memory r) {
        r = new uint256[](1);
        r[0] = x;
    }
}
