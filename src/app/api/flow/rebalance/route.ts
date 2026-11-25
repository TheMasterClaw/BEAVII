import { NextRequest, NextResponse } from 'next/server';
import { IS_DEPLOYED } from '@/config/base-sepolia';

/**
 * Legacy endpoint used by the ITF client. Forwards to the stock agent, which pushes live NAV
 * onchain and calls StockBasketVault.rebalance() (needs STOCK_AGENT_SECRET / CRON_SECRET).
 */
export async function POST(request: NextRequest) {
  if (!IS_DEPLOYED) return NextResponse.json({ success: false, error: 'Base Sepolia vault not deployed' }, { status: 503 });
  const secret = process.env.STOCK_AGENT_SECRET || process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ success: false, error: 'Set STOCK_AGENT_SECRET to enable server-side rebalancing' }, { status: 501 });
  const res = await fetch(new URL('/api/stocks/agent', request.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
    body: JSON.stringify({ action: 'rebalance' }),
  });
  const body = await res.json();
  return NextResponse.json(
    res.ok ? { success: true, data: { rebalanced: true, txHash: body.txHash, timestamp: new Date().toISOString() } } : { success: false, error: body.error },
    { status: res.status },
  );
}
