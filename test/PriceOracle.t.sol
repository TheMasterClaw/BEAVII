// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BaseTest} from "./Base.t.sol";
import {PriceOracle} from "../contracts/PriceOracle.sol";
import {StockExchange} from "../contracts/StockExchange.sol";
import {UniswapV3Venue, ISwapRouter02} from "../contracts/UniswapV3Venue.sol";
import {MockAggregator, MockSwapRouter, MockToken} from "./mocks/Mocks.sol";

contract PriceOracleTest is BaseTest {
    function test_AgentDeviationBound() public {
        vm.startPrank(agent);
        oracle.setPrices(_one(address(a)), _one(115e8)); // +15% ok (bound 20%)
        vm.expectRevert(abi.encodeWithSelector(PriceOracle.DeviationTooHigh.selector, address(a), 115e8, 150e8));
        oracle.setPrices(_one(address(a)), _one(150e8));
        vm.stopPrank();
        vm.prank(owner);
        oracle.setPrices(_one(address(a)), _one(150e8)); // owner may reprice past the bound
        assertEq(oracle.price(address(a)), 150e8);
    }

    function test_AgentMayResetStalePrice() public {
        vm.warp(block.timestamp + 3 days + 1);
        vm.prank(agent);
        oracle.setPrices(_one(address(a)), _one(300e8));
        assertEq(oracle.checkedPrice(address(a)), 300e8);
    }

    function test_OnlyAgent() public {
        vm.prank(alice);
        vm.expectRevert(PriceOracle.NotAgent.selector);
        oracle.setPrices(_one(address(a)), _one(1e8));
    }

    function test_ZeroPriceRejected() public {
        vm.prank(agent);
        vm.expectRevert(PriceOracle.ZeroPrice.selector);
        oracle.setPrices(_one(address(a)), _one(0));
    }

    function test_FeedOverridesPush_ScalesAndChecksHeartbeat() public {
        MockAggregator feed = new MockAggregator(18);
        feed.set(123e18, block.timestamp, block.timestamp);
        vm.prank(owner);
        oracle.setFeed(address(a), address(feed), 1 hours);
        assertEq(oracle.checkedPrice(address(a)), 123e8);
        vm.warp(block.timestamp + 1 hours + 1);
        vm.expectRevert(abi.encodeWithSelector(PriceOracle.StalePrice.selector, address(a)));
        oracle.checkedPrice(address(a));
    }

    function test_FeedNonPositiveAnswerIsStale() public {
        MockAggregator feed = new MockAggregator(8);
        feed.set(-1, block.timestamp, block.timestamp);
        vm.prank(owner);
        oracle.setFeed(address(a), address(feed), 1 hours);
        assertEq(oracle.price(address(a)), 0);
        vm.expectRevert(abi.encodeWithSelector(PriceOracle.StalePrice.selector, address(a)));
        oracle.checkedPrice(address(a));
    }

    function test_SequencerDownAndGracePeriod() public {
        MockAggregator seq = new MockAggregator(0);
        vm.prank(owner);
        oracle.setSequencerUptimeFeed(address(seq));

        seq.set(1, block.timestamp - 2 hours, block.timestamp); // down
        vm.expectRevert(PriceOracle.SequencerDown.selector);
        oracle.checkedPrice(address(a));

        seq.set(0, block.timestamp - 10 minutes, block.timestamp); // up, inside grace period
        vm.expectRevert(PriceOracle.SequencerDown.selector);
        oracle.checkedPrice(address(a));

        seq.set(0, block.timestamp - 2 hours, block.timestamp);
        assertEq(oracle.checkedPrice(address(a)), PRICE_A);
    }

    function test_CashTokenNotListable() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(PriceOracle.NotListable.selector, address(cash)));
        oracle.setListed(_one(address(cash)), true);
    }

    // ------------------------------------------------------------------ testnet exchange

    function test_Exchange_FactorySetOnce_RegisterOnlyFactory() public {
        vm.prank(owner);
        vm.expectRevert(StockExchange.FactoryAlreadySet.selector);
        exchange.setFactory(alice);
        vm.prank(owner);
        vm.expectRevert(StockExchange.NotFactory.selector);
        exchange.registerVault(owner);
    }

    function test_Exchange_OnlyVaultsTrade() public {
        vm.prank(alice);
        vm.expectRevert(StockExchange.NotVault.selector);
        exchange.buy(address(a), 1e6, 0);
    }

    // ------------------------------------------------------------------ mainnet venue

    function test_UniswapV3Venue_RoutesWithPoolFeeAndMinOut() public {
        MockSwapRouter router = new MockSwapRouter();
        UniswapV3Venue venue = new UniswapV3Venue(address(cash), ISwapRouter02(address(router)), owner);
        router.setRate(address(cash), address(a), 1e18); // 100e6 cash ($100) -> 1 A (1e8 units)
        cash.mint(alice, 100e6);

        vm.startPrank(alice);
        cash.approve(address(venue), 100e6);
        vm.expectRevert(abi.encodeWithSelector(UniswapV3Venue.NoPool.selector, address(a)));
        venue.buy(address(a), 100e6, 0);
        vm.stopPrank();

        vm.prank(owner);
        venue.setPoolFee(address(a), 3000);

        vm.startPrank(alice);
        vm.expectRevert(bytes("Too little received"));
        venue.buy(address(a), 100e6, 1e8 + 1);
        venue.buy(address(a), 100e6, 1e8);
        vm.stopPrank();
        assertEq(a.balanceOf(alice), 1e8);
        assertEq(router.lastFee(), 3000);
        assertEq(cash.allowance(address(venue), address(router)), 0);
    }
}
