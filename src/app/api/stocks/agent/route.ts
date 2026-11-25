import { NextRequest, NextResponse } from 'next/server';
import { HAS_EXCHANGE, IS_DEPLOYED, findStock } from '@/config/base-sepolia';
import { getStockAgentSigner, getStockVault } from '@/lib/stock-vault';
import { isAgentAuthorized as authorized, rebalanceFlagship, syncPrices } from '@/lib/stock-agent';

export const dynamic = 'force-dynamic';

/**
 * GET  /api/stocks/agent            -> sync NAV prices (cron)
 * POST /api/stocks/agent { action }  -> "sync-prices" | "rebalance" | "set-weights" (weights: {TSLAc: 2500, ...})
 * Every action needs `Authorization: Bearer <STOCK_AGENT_SECRET|CRON_SECRET>`. sync-prices used to be open, but
 * letting anyone choose when the oracle moves enables a deposit -> sync -> withdraw arbitrage (audit F-03).
 * set-weights needs the agent key to own the vault (vault.setWeights is onlyOwner).
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!HAS_EXCHANGE) return NextResponse.json({ error: 'StockExchange not deployed' }, { status: 503 });
  try {
    return NextResponse.json({ ok: true, ...(await syncPrices()) });
  } catch (e) {
    console.error('stock agent cron failed', e);
    return NextResponse.json({ error: 'price sync failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!HAS_EXCHANGE) return NextResponse.json({ error: 'StockExchange not deployed' }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { action?: string; weights?: Record<string, number> };
  try {
    switch (body.action) {
      case 'sync-prices':
        return NextResponse.json({ ok: true, ...(await syncPrices()) });
      case 'rebalance': {
        if (!IS_DEPLOYED) return NextResponse.json({ error: 'vault not deployed' }, { status: 503 });
        return NextResponse.json({ ok: true, ...(await rebalanceFlagship()) });
      }
      case 'set-weights': {
        if (!IS_DEPLOYED) return NextResponse.json({ error: 'vault not deployed' }, { status: 503 });
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
    return NextResponse.json({ error: 'agent action failed' }, { status: 500 });
  }
}
