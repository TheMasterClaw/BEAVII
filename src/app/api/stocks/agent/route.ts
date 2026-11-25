import { NextRequest, NextResponse } from 'next/server';
import { HAS_ORACLE } from '@/config/network';
import { PRICE_PUSH_ENABLED, isAgentAuthorized, queueFlagshipBasket, rebalanceFlagship, syncPrices } from '@/lib/stock-agent';

export const dynamic = 'force-dynamic';

/**
 * GET  /api/stocks/agent            -> sync prices (Vercel cron)
 * POST /api/stocks/agent { action }  -> "sync-prices" | "rebalance" | "queue-basket" (weights: {TSLAc: 2500, ...})
 *
 * Every action spends the agent wallet's gas, so every action requires
 * `Authorization: Bearer <STOCK_AGENT_SECRET|CRON_SECRET>`. Errors are logged server-side and returned generically.
 */
export async function GET(req: NextRequest) {
  if (!isAgentAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!HAS_ORACLE) return NextResponse.json({ error: 'PriceOracle not deployed' }, { status: 503 });
  if (!PRICE_PUSH_ENABLED) return NextResponse.json({ ok: true, skipped: 'prices come from oracle feeds on this network' });
  try {
    return NextResponse.json({ ok: true, ...(await syncPrices()) });
  } catch (e) {
    console.error('stock agent sync failed', e);
    return NextResponse.json({ error: 'price sync failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isAgentAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!HAS_ORACLE) return NextResponse.json({ error: 'PriceOracle not deployed' }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { action?: string; weights?: Record<string, number> };
  try {
    switch (body.action) {
      case 'sync-prices':
        return NextResponse.json({ ok: true, ...(await syncPrices()) });
      case 'rebalance':
        return NextResponse.json({ ok: true, ...(await rebalanceFlagship()) });
      case 'queue-basket':
        return NextResponse.json({ ok: true, ...(await queueFlagshipBasket(body.weights ?? {})) });
      default:
        return NextResponse.json({ error: 'action must be sync-prices | rebalance | queue-basket' }, { status: 400 });
    }
  } catch (e) {
    console.error(`stock agent ${body.action} failed`, e);
    return NextResponse.json({ error: `${body.action} failed` }, { status: 500 });
  }
}
