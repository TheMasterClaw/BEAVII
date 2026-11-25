import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { BASE_SEPOLIA, CASH_TOKEN, DEPLOYMENT, EXCHANGE_ADDRESS, HAS_EXCHANGE, IS_DEPLOYED, STOCKS, STOCK_VAULT } from '@/config/base-sepolia';
import { fetchAllStockPrices } from '@/lib/stock-prices';
import { getBaseTokenizedStocks } from '@/lib/coinmarketcap';
import { b20Iface, exchangeIface, getStockVault, multicall } from '@/lib/stock-vault';

export const dynamic = 'force-dynamic';

const ZERO = BigInt(0);
type Holding = { token: string; targetWeight: bigint; balance: bigint; valueUsd: bigint };

/**
 * GET /api/stocks[?address=0x..]
 * Every Coinbase tokenized stock on Base and its Base Sepolia test mirror:
 * - livePrice: Coinbase NAV where published, else the underlying's market price x multiplier
 * - onchainPrice / listed: what the shared StockExchange currently uses
 * - basket fields for the flagship vault, and wallet balances when ?address is given
 */
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address');
  if (address && !ethers.isAddress(address)) return NextResponse.json({ error: 'invalid address' }, { status: 400 });

  const [live, cmc] = await Promise.all([
    fetchAllStockPrices().catch(() => null),
    getBaseTokenizedStocks().catch((e) => {
      console.warn('CoinMarketCap stats unavailable', (e as Error).message);
      return null;
    }),
  ]);
  const cmcByAddress = new Map((cmc ?? []).map((t) => [t.baseAddress, t]));
  const base = {
    network: { chainId: BASE_SEPOLIA.chainId, name: BASE_SEPOLIA.name, explorer: BASE_SEPOLIA.blockExplorer, faucetUrl: BASE_SEPOLIA.faucetUrl },
    deployed: IS_DEPLOYED,
    hasExchange: HAS_EXCHANGE,
    exchange: EXCHANGE_ADDRESS || null,
    factory: DEPLOYMENT.factory?.address ?? null,
    cashToken: CASH_TOKEN,
    agentWallet: DEPLOYMENT.agentWallet,
    priceSources: { nav: 'Coinbase Tokenized Stocks API', market: 'Underlying market price x token multiplier', stats: 'CoinMarketCap (Base mainnet token)' },
  };

  // Before the test tokens exist, still serve the full mainnet catalog with live prices.
  const catalog = STOCKS.length
    ? STOCKS
    : (live?.records ?? []).map((r) => ({
        symbol: r.symbol,
        testSymbol: `t${r.symbol}`,
        name: r.name,
        address: '',
        mainnetAddress: r.contract_address,
        decimals: r.decimals,
        isin: r.isin,
        iconUrl: r.icon_url,
        multiplier: Number(r.multiplier) || 1,
        hasNav: Boolean(r.nav_price),
      }));

  try {
    const deployedStocks = catalog.filter((s) => s.address);
    const now = Math.floor(Date.now() / 1000);

    // Exchange prices + listing, one multicall for the whole catalog
    let exPrice: (bigint | null)[] = [];
    let exUpdated: (bigint | null)[] = [];
    let exListed: (boolean | null)[] = [];
    if (HAS_EXCHANGE && deployedStocks.length) {
      const calls = deployedStocks.flatMap((s) => [
        { target: EXCHANGE_ADDRESS, iface: exchangeIface, fn: 'price', args: [s.address] },
        { target: EXCHANGE_ADDRESS, iface: exchangeIface, fn: 'priceUpdatedAt', args: [s.address] },
        { target: EXCHANGE_ADDRESS, iface: exchangeIface, fn: 'isListed', args: [s.address] },
      ]);
      const r = await multicall<bigint | boolean>(calls);
      exPrice = deployedStocks.map((_, i) => r[i * 3] as bigint | null);
      exUpdated = deployedStocks.map((_, i) => r[i * 3 + 1] as bigint | null);
      exListed = deployedStocks.map((_, i) => r[i * 3 + 2] as boolean | null);
    }

    // Wallet balances
    let user: Record<string, unknown> | null = null;
    let userBals: (bigint | null)[] = [];
    if (address) {
      const calls = [
        ...(CASH_TOKEN.address ? [{ target: CASH_TOKEN.address, iface: b20Iface, fn: 'balanceOf', args: [address] }] : []),
        ...deployedStocks.map((s) => ({ target: s.address, iface: b20Iface, fn: 'balanceOf', args: [address] })),
      ];
      const r = calls.length ? await multicall<bigint>(calls) : [];
      const cash = CASH_TOKEN.address ? r.shift() ?? ZERO : ZERO;
      userBals = r;
      user = { address, cash: ethers.formatUnits(cash, CASH_TOKEN.decimals) };
    }

    // Flagship vault
    let vaultInfo: Record<string, unknown> | null = null;
    const held = new Map<string, Holding>();
    if (IS_DEPLOYED) {
      const vault = getStockVault();
      const [holdings, totalValue, nav, supply, name, symbol, lastRebalance, shares] = await Promise.all([
        vault.getHoldings() as Promise<Holding[]>,
        vault.getTotalValue() as Promise<bigint>,
        vault.getNetAssetValue() as Promise<bigint>,
        vault.totalSupply() as Promise<bigint>,
        vault.name() as Promise<string>,
        vault.symbol() as Promise<string>,
        vault.lastRebalanceTime() as Promise<bigint>,
        address ? (vault.balanceOf(address) as Promise<bigint>) : Promise.resolve(ZERO),
      ]);
      for (const h of holdings) held.set(h.token.toLowerCase(), h);
      vaultInfo = {
        address: STOCK_VAULT.address,
        name,
        symbol,
        totalValueUsd: Number(ethers.formatEther(totalValue)),
        navPerShare: Number(ethers.formatEther(nav)),
        totalShares: ethers.formatEther(supply),
        lastRebalance: Number(lastRebalance),
      };
      if (user) {
        user.shares = ethers.formatEther(shares);
        user.sharesValueUsd = supply > ZERO ? Number(ethers.formatEther((shares * totalValue) / supply)) : 0;
      }
    }

    const deployedIndex = new Map(deployedStocks.map((s, i) => [s.symbol, i]));
    const stocks = catalog.map((s) => {
      const i = deployedIndex.get(s.symbol);
      const lp = live?.prices[s.symbol];
      const p = i !== undefined ? exPrice[i] : null;
      const upd = i !== undefined ? Number(exUpdated[i] ?? 0) : 0;
      const h = s.address ? held.get(s.address.toLowerCase()) : undefined;
      const m = s.mainnetAddress ? cmcByAddress.get(s.mainnetAddress.toLowerCase()) : undefined;
      return {
        symbol: s.symbol,
        testSymbol: s.testSymbol,
        name: s.name,
        address: s.address,
        mainnetAddress: s.mainnetAddress,
        decimals: s.decimals,
        isin: s.isin,
        iconUrl: s.iconUrl,
        multiplier: s.multiplier,
        livePrice: lp?.price ?? null,
        priceSource: lp?.source ?? null,
        livePriceUpdatedAt: lp?.updatedAt ?? null,
        listed: i !== undefined ? Boolean(exListed[i]) : false,
        onchainPrice: p && p > ZERO ? Number(ethers.formatUnits(p, 8)) : null,
        onchainPriceAgeSec: upd ? now - upd : null,
        inBasket: Boolean(h && h.targetWeight > ZERO),
        targetWeightBps: h ? Number(h.targetWeight) : 0,
        vaultBalance: h ? ethers.formatUnits(h.balance, s.decimals) : '0',
        vaultValueUsd: h ? Number(ethers.formatEther(h.valueUsd)) : 0,
        userBalance: i !== undefined && userBals[i] ? ethers.formatUnits(userBals[i]!, s.decimals) : '0',
        // Base mainnet token stats from CoinMarketCap; null when CMC doesn't track this token
        market: m
          ? {
              cmcId: m.id,
              price: m.price,
              marketCap: m.marketCap,
              volume24h: m.volume24h,
              percentChange24h: m.percentChange24h,
              percentChange7d: m.percentChange7d,
              cmcRank: m.cmcRank,
              updatedAt: m.lastUpdated,
            }
          : null,
      };
    });

    return NextResponse.json({
      ...base,
      tokensCreated: deployedStocks.length,
      vault: vaultInfo,
      stocks,
      user,
      ...(deployedStocks.length ? {} : { hint: 'Test tokens not created yet: run `node scripts/create-stock-tokens.mjs`.' }),
    });
  } catch (e) {
    console.error('GET /api/stocks failed', e);
    return NextResponse.json({ ...base, error: 'Failed to read Base Sepolia state' }, { status: 502 });
  }
}
