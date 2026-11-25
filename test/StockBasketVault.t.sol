// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BaseTest} from "./Base.t.sol";
import {StockBasketVault} from "../contracts/StockBasketVault.sol";
import {ETFFactory} from "../contracts/ETFFactory.sol";
import {PriceOracle} from "../contracts/PriceOracle.sol";
import {IVenue} from "../contracts/Interfaces.sol";
import {HaircutVenue, MockSanctions, MockToken} from "./mocks/Mocks.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract StockBasketVaultTest is BaseTest {
    // ------------------------------------------------------------------ deposits / redemptions

    function test_DepositCash_BuysBasketAtNav() public {
        uint256 shares = _deposit(vault, alice, 1_000e6);
        assertEq(shares, 1_000e18);
        assertEq(vault.getAsset(address(a)).balance, 6e8); // $600 / $100
        assertEq(vault.getAsset(address(b)).balance, 8e18); // $400 / $50
        assertEq(a.balanceOf(address(vault)), 6e8);
        assertEq(vault.getTotalValue(), 1_000e18);
        assertEq(vault.getNetAssetValue(), 1e18);
        assertEq(cash.balanceOf(address(vault)), 0);
    }

    function test_SecondDeposit_PricedAtCurrentNav() public {
        _deposit(vault, alice, 1_000e6);
        _setPrices(PRICE_A * 2, PRICE_B); // NAV 1000 -> 1600
        uint256 shares = _deposit(vault, bob, 1_600e6);
        assertApproxEqAbs(shares, 1_000e18, 1e9);
    }

    function test_DepositRespectsMinShares() public {
        vm.startPrank(alice);
        cash.approve(address(vault), 1_000e6);
        vm.expectRevert(abi.encodeWithSelector(StockBasketVault.Slippage.selector, 1_000e18, 1_001e18));
        vault.deposit(address(cash), 1_000e6, 1_001e18);
        vm.stopPrank();
    }

    function test_DepositInKind() public {
        a.mint(alice, 1e8);
        vm.startPrank(alice);
        a.approve(address(vault), 1e8);
        uint256 shares = vault.deposit(address(a), 1e8, 0);
        vm.stopPrank();
        assertEq(shares, 100e18);
    }

    function test_WithdrawCash_RoundTrip() public {
        _deposit(vault, alice, 1_000e6);
        uint256 before = cash.balanceOf(alice);
        vm.prank(alice);
        uint256 out = vault.withdraw(1_000e18, address(cash), 999e6);
        assertEq(out, 1_000e6);
        assertEq(cash.balanceOf(alice) - before, 1_000e6);
        assertEq(vault.totalSupply(), 0);
        assertEq(vault.getAsset(address(a)).balance, 0);
    }

    function test_WithdrawInKind_ProRata() public {
        _deposit(vault, alice, 1_000e6);
        _deposit(vault, bob, 1_000e6);
        vm.prank(alice);
        vault.withdraw(1_000e18, address(0), 0);
        assertEq(a.balanceOf(alice), 6e8);
        assertEq(b.balanceOf(alice), 8e18);
        assertEq(vault.getAsset(address(a)).balance, 6e8);
    }

    // ------------------------------------------------------------------ NAV integrity

    function test_Donation_DoesNotMoveNav() public {
        _deposit(vault, alice, 1e6);
        uint256 navBefore = vault.getNetAssetValue();
        a.mint(address(vault), 1_000e8); // $100k donated straight to the vault
        cash.mint(address(vault), 50_000e6);
        assertEq(vault.getNetAssetValue(), navBefore);
        uint256 shares = _deposit(vault, bob, 1_000e6);
        assertEq(shares, 1_000e18); // bob is not diluted by the donation
    }

    function test_Sweep_OnlyExcess() public {
        _deposit(vault, alice, 1_000e6);
        a.mint(address(vault), 5e8);
        vm.prank(manager);
        vault.sweep(address(a), manager);
        assertEq(a.balanceOf(manager), 5e8);
        assertEq(a.balanceOf(address(vault)), 6e8);
        vm.prank(manager);
        vm.expectRevert(StockBasketVault.NothingToSweep.selector);
        vault.sweep(address(a), manager);
    }

    function test_StalePrice_BlocksValueActions_InKindStillWorks() public {
        _deposit(vault, alice, 1_000e6);
        vm.warp(block.timestamp + 3 days + 1);

        vm.startPrank(alice);
        cash.approve(address(vault), 1_000e6);
        vm.expectRevert(abi.encodeWithSelector(PriceOracle.StalePrice.selector, address(a)));
        vault.deposit(address(cash), 1_000e6, 0);
        vm.expectRevert(abi.encodeWithSelector(PriceOracle.StalePrice.selector, address(a)));
        vault.withdraw(100e18, address(cash), 0);
        vault.withdraw(100e18, address(0), 0);
        vm.stopPrank();
        assertGt(a.balanceOf(alice), 0);
    }

    function test_UnpricedAsset_RevertsInsteadOfUnderpricing() public {
        MockToken c = new MockToken("C", 8);
        vm.prank(owner);
        oracle.setListed(_one(address(c)), true);
        _deposit(vault, alice, 1_000e6);
        c.mint(alice, 1e8);
        // switch basket to include the unpriced token (applies at once? no: vault has holders -> queued)
        vm.prank(manager);
        vault.queueBasket(_arr(address(a), address(c)), _arr(5_000, 5_000));
        vm.warp(block.timestamp + 1 days);
        _setPrices(PRICE_A, PRICE_B);
        vault.applyPendingBasket();
        vm.startPrank(alice);
        c.approve(address(vault), 1e8);
        vm.expectRevert(abi.encodeWithSelector(PriceOracle.StalePrice.selector, address(c)));
        vault.deposit(address(c), 1e8, 0);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ slippage / venue

    function test_BadVenue_RevertsOnSlippage() public {
        HaircutVenue bad = new HaircutVenue(oracle, 500); // fills 5% worse than oracle, cap is 1%
        ETFFactory f = _newFactory(IVenue(address(bad)), 100);
        vm.prank(owner);
        f.setPermissionless(true);
        StockBasketVault v = _createEtf(f, _fees(0, 0, 0));
        vm.startPrank(alice);
        cash.approve(address(v), 1_000e6);
        vm.expectRevert(abi.encodeWithSelector(StockBasketVault.Slippage.selector, 57e7, 594e6));
        v.deposit(address(cash), 1_000e6, 0);
        vm.stopPrank();
    }

    function test_DepositorBearsSlippage_NotHolders() public {
        HaircutVenue venue = new HaircutVenue(oracle, 50); // 0.5% worse, within the 1% cap
        ETFFactory f = _newFactory(IVenue(address(venue)), 100);
        vm.prank(owner);
        f.setPermissionless(true);
        StockBasketVault v = _createEtf(f, _fees(0, 0, 0));
        _deposit(v, alice, 1_000e6);
        uint256 navPerShare = v.getNetAssetValue();
        _deposit(v, bob, 1_000e6);
        assertGe(v.getNetAssetValue(), navPerShare - 1); // alice not diluted by bob's execution cost
        assertApproxEqRel(v.balanceOf(bob), 995e18, 1e15);
    }

    // ------------------------------------------------------------------ fees

    function test_EntryFee_SplitWithProtocol() public {
        StockBasketVault v = _createEtf(factory, _fees(0, 100, 0));
        uint256 shares = _deposit(v, alice, 1_000e6);
        assertEq(shares, 990e18);
        assertEq(v.balanceOf(manager), 8e18); // 80% of the 10-share fee
        assertEq(v.balanceOf(treasury), 2e18);
    }

    function test_ManagementFee_OneYear() public {
        StockBasketVault v = _createEtf(factory, _fees(500, 0, 0));
        _deposit(v, alice, 1_000e6);
        vm.warp(block.timestamp + 365 days);
        v.accrueFees();
        uint256 supply = v.totalSupply();
        uint256 feeShares = v.balanceOf(manager) + v.balanceOf(treasury);
        assertApproxEqRel((feeShares * 1e18) / supply, 0.05e18, 1e12); // fee owns exactly 5% of the fund
    }

    function test_ExitFee() public {
        StockBasketVault v = _createEtf(factory, _fees(0, 0, 100));
        _deposit(v, alice, 1_000e6);
        vm.prank(alice);
        uint256 out = v.withdraw(1_000e18, address(cash), 0);
        assertEq(out, 990e6);
        assertEq(v.balanceOf(manager) + v.balanceOf(treasury), 10e18);
    }

    function test_FeeIncrease_IsTimelocked() public {
        vm.prank(manager);
        vault.setFees(_fees(100, 0, 0));
        (uint16 m,,) = vault.fees();
        assertEq(m, 0);
        vm.expectRevert(StockBasketVault.FeesNotReady.selector);
        vault.applyPendingFees();
        vm.warp(block.timestamp + 3 days);
        vault.applyPendingFees();
        (m,,) = vault.fees();
        assertEq(m, 100);
    }

    function test_FeeCaps() public {
        vm.prank(manager);
        vm.expectRevert(StockBasketVault.FeeTooHigh.selector);
        vault.setFees(_fees(501, 0, 0));
    }

    // ------------------------------------------------------------------ basket changes

    function test_Basket_ImmediateWithoutHolders() public {
        vm.prank(manager);
        vault.queueBasket(_one(address(a)), _one(10_000));
        assertEq(vault.assetCount(), 1);
        assertEq(vault.pendingBasketEta(), 0);
    }

    function test_Basket_TimelockedWithHolders_ThenRebalanceSellsRemoved() public {
        _deposit(vault, alice, 1_000e6);
        vm.prank(manager);
        vault.queueBasket(_one(address(a)), _one(10_000));
        assertEq(vault.getAsset(address(b)).targetWeight, 4_000);
        vm.expectRevert(StockBasketVault.BasketNotReady.selector);
        vault.applyPendingBasket();

        vm.warp(block.timestamp + 1 days);
        _setPrices(PRICE_A, PRICE_B);
        vault.applyPendingBasket();
        assertEq(vault.getAsset(address(b)).targetWeight, 0);

        vm.prank(agent);
        vault.rebalance();
        assertEq(vault.getAsset(address(b)).balance, 0);
        assertEq(vault.getAsset(address(a)).balance, 10e8);
        assertApproxEqAbs(vault.getTotalValue(), 1_000e18, 1e12);
    }

    function test_Basket_RejectsDuplicatesUnlistedAndBadWeights() public {
        vm.startPrank(manager);
        vm.expectRevert(abi.encodeWithSelector(StockBasketVault.DuplicateAsset.selector, address(a)));
        vault.queueBasket(_arr(address(a), address(a)), _arr(5_000, 5_000));
        vm.expectRevert(abi.encodeWithSelector(StockBasketVault.UnsupportedToken.selector, address(cash)));
        vault.queueBasket(_arr(address(a), address(cash)), _arr(5_000, 5_000));
        vm.expectRevert(abi.encodeWithSelector(StockBasketVault.BadWeights.selector, 9_000));
        vault.queueBasket(_arr(address(a), address(b)), _arr(5_000, 4_000));
        vm.stopPrank();
    }

    function test_Basket_OnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vault.queueBasket(_one(address(a)), _one(10_000));
    }

    // ------------------------------------------------------------------ rebalance

    function test_Rebalance_RestoresWeights() public {
        _deposit(vault, alice, 1_000e6);
        _setPrices(PRICE_A * 2, PRICE_B); // A now 1200 of 1600 = 75%
        vm.prank(agent);
        vault.rebalance();
        StockBasketVault.AssetView[] memory h = vault.getHoldings();
        uint256 total = vault.getTotalValue();
        assertApproxEqAbs((h[0].valueUsd * 10_000) / total, 6_000, 2);
        assertApproxEqAbs((h[1].valueUsd * 10_000) / total, 4_000, 2);
    }

    function test_Rebalance_Cooldown() public {
        _deposit(vault, alice, 1_000e6);
        vm.startPrank(agent);
        vault.rebalance();
        vm.expectRevert(
            abi.encodeWithSelector(StockBasketVault.RebalanceTooSoon.selector, block.timestamp + 12 hours)
        );
        vault.rebalance();
        vm.stopPrank();
    }

    function test_Rebalance_OnlyAgentOrManager() public {
        vm.prank(alice);
        vm.expectRevert(StockBasketVault.NotAgent.selector);
        vault.rebalance();
    }

    // ------------------------------------------------------------------ pause, caps, sanctions

    function test_Pause_InKindStillWorks() public {
        _deposit(vault, alice, 1_000e6);
        vm.prank(owner); // factory owner = guardian
        vault.emergencyPause();
        vm.startPrank(alice);
        vm.expectRevert();
        vault.withdraw(100e18, address(cash), 0);
        vault.withdraw(100e18, address(0), 0);
        vm.stopPrank();
    }

    function test_TvlCap() public {
        vm.prank(owner);
        factory.setTvlCapUsd(1_500e18);
        _deposit(vault, alice, 1_000e6);
        vm.startPrank(bob);
        cash.approve(address(vault), 1_000e6);
        vm.expectRevert(abi.encodeWithSelector(StockBasketVault.TvlCapExceeded.selector, 2_000e18, 1_500e18));
        vault.deposit(address(cash), 1_000e6, 0);
        vm.stopPrank();
    }

    function test_Sanctions() public {
        MockSanctions list = new MockSanctions();
        vm.prank(owner);
        factory.setSanctionsList(address(list));
        _deposit(vault, alice, 1_000e6);
        list.set(bob, true);

        vm.startPrank(bob);
        cash.approve(address(vault), 1_000e6);
        vm.expectRevert(abi.encodeWithSelector(StockBasketVault.Sanctioned.selector, bob));
        vault.deposit(address(cash), 1_000e6, 0);
        vm.stopPrank();

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(StockBasketVault.Sanctioned.selector, bob));
        vault.transfer(bob, 1e18);
    }

    // ------------------------------------------------------------------ factory

    function test_Factory_PermissionedByDefault() public {
        StockBasketVault impl = new StockBasketVault();
        ETFFactory f =
            new ETFFactory(address(impl), address(oracle), address(exchange), treasury, 2_000, agent, 100, owner);
        ETFFactory.CreateParams memory p = ETFFactory.CreateParams(
            "X", "X", "", address(0), _one(address(a)), _one(10_000), _fees(0, 0, 0)
        );
        vm.prank(alice);
        vm.expectRevert(ETFFactory.NotApprovedManager.selector);
        f.createETF(p);
        vm.prank(owner);
        f.setManagerApproval(alice, true);
        // exchange is wired to the fixture factory only, so registration through this one is refused
        vm.prank(alice);
        vm.expectRevert();
        f.createETF(p);
    }

    function test_Factory_Caps() public {
        vm.startPrank(owner);
        vm.expectRevert(ETFFactory.SlippageTooHigh.selector);
        factory.setMaxSlippageBps(301);
        vm.expectRevert(ETFFactory.FeeTooHigh.selector);
        factory.setProtocolFeeBps(3_001);
        vm.stopPrank();
    }

    function test_Ownership_IsTwoStep() public {
        address safe = makeAddr("safe");
        vm.prank(owner);
        factory.transferOwnership(safe);
        assertEq(factory.owner(), owner);
        vm.prank(safe);
        factory.acceptOwnership();
        assertEq(factory.owner(), safe);
    }

    function test_Implementation_Locked() public {
        StockBasketVault impl = StockBasketVault(factory.implementation());
        StockBasketVault.InitParams memory p;
        vm.expectRevert(StockBasketVault.AlreadyInitialized.selector);
        impl.initialize(p);
    }

    // ------------------------------------------------------------------ fuzz

    /// @dev No fees, constant prices: a deposit followed by a full cash redemption returns the deposit
    ///      minus at most rounding dust, and never more.
    function testFuzz_DepositRedeem_NoFreeMoney(uint256 amount, uint256 priorAmount) public {
        amount = bound(amount, 1e6, 10_000_000e6);
        priorAmount = bound(priorAmount, 0, 10_000_000e6);
        if (priorAmount >= 1e6) {
            _fund(bob, priorAmount);
            _deposit(vault, bob, priorAmount);
        }
        _fund(alice, amount);
        uint256 before = cash.balanceOf(alice);
        uint256 shares = _deposit(vault, alice, amount);
        vm.prank(alice);
        vault.withdraw(shares, address(cash), 0);
        uint256 afterBal = cash.balanceOf(alice);
        assertLe(afterBal, before);
        assertLe(before - afterBal, 3); // a few units of rounding
    }
}
