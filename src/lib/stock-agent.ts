/**
 * Server-only protocol agent: pushes prices onto the PriceOracle and rebalances the flagship ETF.
 * Shared by /api/stocks/agent, the Vercel cron and /api/health.
 */
import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { HAS_ORACLE, IS_DEPLOYED, IS_MAINNET, ORACLE_ADDRESS, STOCKS, findStock } from '@/config/network';
import { fetchAllStockPrices } from '@/lib/stock-prices';
import { getPriceOracle, getStockAgentSigner, getStockVault, multicall, oracleIface, toPrice8 } from '@/lib/stock-vault';

const PRICE_BATCH = 100;

/**
 * Pushed prices come from the Coinbase NAV API and Yahoo Finance market prices. That is acceptable on
 * testnet, but on mainnet prices should come from Chainlink-style feeds set on the oracle (`setFeed`).
 * Pushing on mainnet must be opted into explicitly, and even then the oracle bounds every agent update by
 * maxDeviationBps.
 */
export const PRICE_PUSH_ENABLED = !IS_MAINNET || process.env.ALLOW_PUSHED_PRICES_ON_MAINNET === 'true';

/**
 * Bearer auth for agent actions, compared in constant time. Accepts STOCK_AGENT_SECRET (operators) or
 * CRON_SECRET (what Vercel cron sends), so setting both to different values doesn't lock the cron out.
 */
export function isAgentAuthorized(req: NextRequest) {
  const got = Buffer.from(req.headers.get('authorization') ?? '');
  return [process.env.STOCK_AGENT_SECRET, process.env.CRON_SECRET].some((secret) => {
    if (!secret) return false;
    const want = Buffer.from(`Bearer ${secret}`);
    return got.length === want.length && timingSafeEqual(got, want);
  });
}

/**
 * Push a live price for every listed stock that has no oracle feed. Batched ~100 per tx.
 * Coinbase NAV where published, else the underlying market price x multiplier.
 */
export async function syncPrices() {
  if (!HAS_ORACLE) throw new Error('PriceOracle not deployed yet');
  if (!PRICE_PUSH_ENABLED) throw new Error('Pushed prices are disabled on mainnet; configure oracle feeds instead');
  const { prices } = await fetchAllStockPrices(0);
  const signer = getStockAgentSigner();
  const oracle = getPriceOracle(signer);
  const candidates = STOCKS.filter((s) => s.address && prices[s.symbol]);
  const state = await multicall<unknown>(
    candidates.flatMap((s) => [
      { target: ORACLE_ADDRESS, iface: oracleIface, fn: 'isListed', args: [s.address] },
      { target: ORACLE_ADDRESS, iface: oracleIface, fn: 'feeds', args: [s.address] },
    ]),
  );
  const rows = candidates.filter((_, i) => {
    const listed = state[i * 2] === true;
    const feed = state[i * 2 + 1] as string | null; // first output of feeds(): the aggregator address
    const hasFeed = typeof feed === 'string' && feed !== '0x0000000000000000000000000000000000000000';
    return listed && !hasFeed;
  });
  if (!rows.length) throw new Error('No listed stocks need pushed prices');

  let nonce = await signer.getNonce('pending');
  const txs = [];
  for (let i = 0; i < rows.length; i += PRICE_BATCH) {
    const batch = rows.slice(i, i + PRICE_BATCH);
    txs.push(await oracle.setPrices(batch.map((s) => s.address), batch.map((s) => toPrice8(prices[s.symbol].price)), { nonce: nonce++ }));
  }
  await Promise.all(txs.map((t) => t.wait()));
  const nav = rows.filter((s) => prices[s.symbol].source === 'nav').length;
  return { txHashes: txs.map((t) => t.hash as string), txHash: txs[txs.length - 1].hash as string, updated: rows.length, fromNav: nav, fromMarket: rows.length - nav };
}

/** Refresh pushed prices (where enabled), then rebalance the flagship ETF. The agent must be authorized on it. */
export async function rebalanceFlagship() {
  if (!IS_DEPLOYED) throw new Error('Flagship ETF not deployed');
  const prices = PRICE_PUSH_ENABLED ? await syncPrices() : null;
  const tx = await getStockVault(getStockAgentSigner()).rebalance();
  await tx.wait();
  return { priceTx: prices?.txHash ?? null, txHash: tx.hash as string };
}

/**
 * Queue a new flagship basket ({TSLAc: 2500, ...}, bps summing to 10,000). Needs the agent key to own the
 * flagship (queueBasket is onlyOwner). It applies after the vault's basket timelock, or at once if empty.
 */
export async function queueFlagshipBasket(weights: Record<string, number>) {
  if (!IS_DEPLOYED) throw new Error('Flagship ETF not deployed');
  const entries = Object.entries(weights);
  const tokens = entries.map(([sym]) => findStock(sym));
  if (!entries.length || tokens.some((t) => !t?.address)) throw new Error('weights must map listed stock symbols to bps');
  const tx = await getStockVault(getStockAgentSigner()).queueBasket(
    tokens.map((t) => t!.address),
    entries.map(([, w]) => BigInt(Math.round(w))),
  );
  await tx.wait();
  return { txHash: tx.hash as string };
}
