// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {BaseTest} from "./Base.t.sol";
import {StockBasketVault} from "../contracts/StockBasketVault.sol";
import {PriceOracle} from "../contracts/PriceOracle.sol";
import {MockToken} from "./mocks/Mocks.sol";

/// @dev Random deposits, redemptions (cash and in kind), donations, price moves, rebalances and time.
contract VaultHandler is Test {
    StockBasketVault internal vault;
    PriceOracle internal oracle;
    MockToken internal cash;
    MockToken internal a;
    MockToken internal b;
    address internal owner;
    address internal agent;
    address[] internal actors;

    constructor(
        StockBasketVault v,
        PriceOracle o,
        MockToken c,
        MockToken a_,
        MockToken b_,
        address owner_,
        address agent_
    ) {
        vault = v;
        oracle = o;
        cash = c;
        a = a_;
        b = b_;
        owner = owner_;
        agent = agent_;
        for (uint256 i; i < 3; ++i) actors.push(makeAddr(string(abi.encode("actor", i))));
    }

    function deposit(uint256 who, uint256 amount) external {
        address u = actors[who % actors.length];
        amount = bound(amount, 1e6, 1_000_000e6);
        cash.mint(u, amount);
        vm.startPrank(u);
        cash.approve(address(vault), amount);
        vault.deposit(address(cash), amount, 0);
        vm.stopPrank();
    }

    function redeem(uint256 who, uint256 frac, bool inKind) external {
        address u = actors[who % actors.length];
        uint256 bal = vault.balanceOf(u);
        if (bal == 0) return;
        uint256 shares = (bal * bound(frac, 1, 100)) / 100;
        vm.prank(u);
        vault.withdraw(shares, inKind ? address(0) : address(cash), 0);
    }

    function donate(uint256 amount) external {
        a.mint(address(vault), bound(amount, 1, 1_000e8));
        cash.mint(address(vault), bound(amount, 1, 1_000e6));
    }

    function movePrices(uint256 pa, uint256 pb) external {
        address[] memory t = new address[](2);
        t[0] = address(a);
        t[1] = address(b);
        uint256[] memory p = new uint256[](2);
        p[0] = bound(pa, 1e8, 1_000e8);
        p[1] = bound(pb, 1e8, 1_000e8);
        vm.prank(owner);
        oracle.setPrices(t, p);
    }

    function rebalance() external {
        vm.warp(block.timestamp + 12 hours);
        address[] memory t = new address[](2);
        t[0] = address(a);
        t[1] = address(b);
        uint256[] memory p = new uint256[](2);
        p[0] = oracle.price(address(a));
        p[1] = oracle.price(address(b));
        vm.prank(owner);
        oracle.setPrices(t, p); // keep prices fresh after the warp
        vm.prank(agent);
        vault.rebalance();
    }
}

contract VaultInvariantTest is BaseTest {
    VaultHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new VaultHandler(vault, oracle, cash, a, b, owner, agent);
        targetContract(address(handler));
    }

    /// @dev Accounted balances are always backed by real token balances.
    function invariant_AccountingBacked() public view {
        assertLe(vault.getAsset(address(a)).balance, a.balanceOf(address(vault)));
        assertLe(vault.getAsset(address(b)).balance, b.balanceOf(address(vault)));
        assertLe(vault.cashBalance(), cash.balanceOf(address(vault)));
    }

    /// @dev When every share has been redeemed the vault holds (at most dust of) nothing, and the asset list
    ///      never grows past MAX_ASSETS.
    function invariant_SupplyMatchesHoldings() public view {
        if (vault.totalSupply() == 0) {
            assertLe(vault.getAsset(address(a)).balance, 1);
            assertLe(vault.getAsset(address(b)).balance, 1e10);
        }
        assertLe(vault.assetCount(), vault.MAX_ASSETS());
    }
}
