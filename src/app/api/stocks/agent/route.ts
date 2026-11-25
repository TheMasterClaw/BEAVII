import { NextRequest, NextResponse } from 'next/server';
import { EXCHANGE_ADDRESS, HAS_EXCHANGE, IS_DEPLOYED, STOCKS, findStock } from '@/config/base-sepolia';
import { fetchAllStockPrices } from '@/lib/stock-prices';
import { exchangeIface, getStockAgentSigner, getStockExchange, getStockVault, multicall, toPrice8 } from '@/lib/stock-vault';

export const dynamic = 'force-dynamic';

const MIN_SYNC_INTERVAL_MS = 2 * 60 * 1000;
let lastSync = 0;

function authorized(req: NextRequest) {
  const secret = process.env.STOCK_AGENT_SECRET || process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

const PRICE_BATCH = 100;

/**
 * Push a live price for every listed test stock onto the shared StockExchange:
 * Coinbase NAV where published, else underlying market price x multiplier. Batched ~100 per tx.
 */
async function syncPrices() {
  if (!HAS_EXCHANGE) throw new Error('StockExchange not deployed yet');
  const { prices } = await fetchAllStockPrices(0);
  const signer = getStockAgentSigner();
  const exchange = getStockExchange(signer);
  const deployed = STOCKS.filter((s) => s.address && prices[s.symbol]);
  const listed = await multicall<boolean>(deployed.map((s) => ({ target: EXCHANGE_ADDRESS, iface: exchangeIface, fn: 'isListed', args: [s.address] })));
  const rows = deployed.filter((_, i) => listed[i]);
  if (!rows.length) throw new Error('No listed stocks with prices');

  let nonce = await signer.getNonce('pending');
  const txs = [];
  for (let i = 0; i < rows.length; i += PRICE_BATCH) {
    const batch = rows.slice(i, i + PRICE_BATCH);
    txs.push(await exchange.setPrices(batch.map((s) => s.address), batch.map((s) => toPrice8(prices[s.symbol].price)), { nonce: nonce++ }));
  }
  await Promise.all(txs.map((t) => t.wait()));
  lastSync = Date.now();
  const nav = rows.filter((s) => prices[s.symbol].source === 'nav').length;
  return { txHashes: txs.map((t) => t.hash), txHash: txs[txs.length - 1].hash, updated: rows.length, fromNav: nav, fromMarket: rows.length - nav };
}

/**
 * GET  /api/stocks/agent            -> sync NAV prices (cron; requires Bearer CRON_SECRET/STOCK_AGENT_SECRET)
 * POST /api/stocks/agent { action }  -> "sync-prices" | "rebalance" | "set-weights" (weights: {TSLAc: 2500, ...})
 * "sync-prices" is open (rate-limited) because it only publishes public price data; the others need the secret.
 * set-weights needs the agent key to own the vault (vault.setWeights is onlyOwner).
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!HAS_EXCHANGE) return NextResponse.json({ error: 'StockExchange not deployed' }, { status: 503 });
  try {
    return NextResponse.json({ ok: true, ...(await syncPrices()) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!HAS_EXCHANGE) return NextResponse.json({ error: 'StockExchange not deployed' }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { action?: string; weights?: Record<string, number> };
  try {
    switch (body.action) {
      case 'sync-prices': {
        if (!authorized(req) && Date.now() - lastSync < MIN_SYNC_INTERVAL_MS) {
          return NextResponse.json({ ok: true, skipped: 'prices synced recently' });
        }
        return NextResponse.json({ ok: true, ...(await syncPrices()) });
      }
      case 'rebalance': {
        if (!IS_DEPLOYED) return NextResponse.json({ error: 'vault not deployed' }, { status: 503 });
        if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
        const prices = await syncPrices();
        const tx = await getStockVault(getStockAgentSigner()).rebalance();
        await tx.wait();
        return NextResponse.json({ ok: true, priceTx: prices.txHash, txHash: tx.hash });
      }
      case 'set-weights': {
        if (!IS_DEPLOYED) return NextResponse.json({ error: 'vault not deployed' }, { status: 503 });
        if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
        const entries = Object.entries(body.weights ?? {});
        const tokens = entries.map(([sym]) => findStock(sym));
        if (!entries.length || tokens.some((t) => !t)) return NextResponse.json({ error: 'weights must map basket symbols to bps' }, { status: 400 });
        const vault = getStockVault(getStockAgentSigner());
        const tx = await vault.setWeights(tokens.map((t) => t!.address), entries.map(([, w]) => BigInt(Math.round(w))));
        await tx.wait();
        return NextResponse.json({ ok: true, txHash: tx.hash });
      }
      default:
        return NextResponse.json({ error: 'action must be sync-prices | rebalance | set-weights' }, { status: 400 });
    }
  } catch (e) {
    console.error('stock agent failed', e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
