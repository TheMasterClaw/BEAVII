/**
 * Server-only stock-agent actions shared by /api/stocks/agent and the legacy /api/flow/rebalance route.
 * Call these directly; never proxy to another route with the secret attached.
 */
import { timingSafeEqual } from 'node:crypto';
import { EXCHANGE_ADDRESS, HAS_EXCHANGE, STOCKS } from '@/config/base-sepolia';
import { fetchAllStockPrices } from '@/lib/stock-prices';
import { exchangeIface, getStockAgentSigner, getStockExchange, getStockVault, multicall, toPrice8 } from '@/lib/stock-vault';
import { recordNavSnapshots } from '@/lib/nav-history/record';

/**
 * True when the request carries `Authorization: Bearer <secret>` for either STOCK_AGENT_SECRET (manual/agent calls)
 * or CRON_SECRET (Vercel sends this one on cron invocations). Constant-time compare.
 */
export function isAgentAuthorized(req: Request): boolean {
  const got = Buffer.from(req.headers.get('authorization') ?? '');
  return [process.env.STOCK_AGENT_SECRET, process.env.CRON_SECRET].some((secret) => {
    if (!secret) return false;
    const want = Buffer.from(`Bearer ${secret}`);
    return got.length === want.length && timingSafeEqual(got, want);
  });
}

const PRICE_BATCH = 100;

/**
 * Serializes everything that signs with the agent key in this server instance (price sync, rebalance, faucet),
 * so concurrent requests don't read the same pending nonce and collide. Cross-instance races remain possible on
 * serverless; a shared queue (KV/Redis) would close that.
 */
let signerQueue: Promise<unknown> = Promise.resolve();
export function withAgentSigner<T>(fn: () => Promise<T>): Promise<T> {
  const run = signerQueue.then(fn, fn);
  signerQueue = run.catch(() => undefined);
  return run;
}

/**
 * Largest move (vs the current onchain price) pushed automatically. Prices are mint/redeem prices for every ETF, so
 * one bad tick from an upstream feed (Yahoo spark is unofficial) would let anyone mint or redeem at a wrong price.
 * Bigger moves (splits, real crashes) are held back and reported; push them with syncPrices({ force: true }).
 */
const MAX_PRICE_MOVE = 0.25;

/**
 * Push a live price for every listed test stock onto the shared StockExchange:
 * Coinbase NAV where published, else underlying market price x multiplier. Batched ~100 per tx.
 */
export async function syncPrices(opts: { force?: boolean } = {}) {
  const result = await withAgentSigner(() => syncPricesUnlocked(opts));
  // NAV only moves when prices do, so snapshot it now for the history charts. Best effort: never fails the sync.
  await recordNavSnapshots().catch((e) => console.error('nav history: snapshot after price sync failed', e));
  return result;
}

async function syncPricesUnlocked({ force = false }: { force?: boolean } = {}) {
  if (!HAS_EXCHANGE) throw new Error('StockExchange not deployed yet');
  const { prices } = await fetchAllStockPrices(0);
  const signer = getStockAgentSigner();
  const exchange = getStockExchange(signer);
  const deployed = STOCKS.filter((s) => s.address && prices[s.symbol] && Number.isFinite(prices[s.symbol].price) && prices[s.symbol].price > 0);
  const state = await multicall<boolean | bigint>(
    deployed.flatMap((s) => [
      { target: EXCHANGE_ADDRESS, iface: exchangeIface, fn: 'isListed', args: [s.address] },
      { target: EXCHANGE_ADDRESS, iface: exchangeIface, fn: 'price', args: [s.address] },
    ]),
  );
  const held: { symbol: string; onchain: number; next: number }[] = [];
  const rows = deployed.filter((s, i) => {
    if (!state[i * 2]) return false;
    const onchain = Number(state[i * 2 + 1] ?? 0n) / 1e8;
    const next = prices[s.symbol].price;
    if (!force && onchain > 0 && Math.abs(next / onchain - 1) > MAX_PRICE_MOVE) {
      held.push({ symbol: s.symbol, onchain, next });
      return false;
    }
    return true;
  });
  if (held.length) console.warn(`price sync: held back ${held.length} moves over ${MAX_PRICE_MOVE * 100}%`, held.slice(0, 20));
  if (!rows.length) throw new Error('No listed stocks with prices');

  let nonce = await signer.getNonce('pending');
  const txs = [];
  for (let i = 0; i < rows.length; i += PRICE_BATCH) {
    const batch = rows.slice(i, i + PRICE_BATCH);
    txs.push(await exchange.setPrices(batch.map((s) => s.address), batch.map((s) => toPrice8(prices[s.symbol].price)), { nonce: nonce++ }));
  }
  await Promise.all(txs.map((t) => t.wait()));
  const nav = rows.filter((s) => prices[s.symbol].source === 'nav').length;
  return {
    txHashes: txs.map((t) => t.hash),
    txHash: txs[txs.length - 1].hash,
    updated: rows.length,
    fromNav: nav,
    fromMarket: rows.length - nav,
    heldBack: held.map((h) => h.symbol),
  };
}

/** Sync prices, then rebalance the flagship vault (the agent key must be an authorized agent on it). */
export function rebalanceFlagship() {
  return withAgentSigner(async () => {
    const prices = await syncPricesUnlocked();
    const tx = await getStockVault(getStockAgentSigner()).rebalance();
    await tx.wait();
    return { priceTx: prices.txHash, txHash: tx.hash as string };
  });
}
