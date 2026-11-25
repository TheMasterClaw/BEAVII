import { NextRequest, NextResponse } from 'next/server';
import { IS_DEPLOYED } from '@/config/base-sepolia';
import { isAgentAuthorized, rebalanceFlagship } from '@/lib/stock-agent';

export const dynamic = 'force-dynamic';

/**
 * Legacy endpoint used by the ITF client: pushes live NAV onchain and calls StockBasketVault.rebalance()
 * on the flagship vault. Requires `Authorization: Bearer <STOCK_AGENT_SECRET|CRON_SECRET>`, like the
 * agent route. ETF managers rebalance their own vaults onchain from their wallet (rebalance() allows the owner).
 */
export async function POST(request: NextRequest) {
  if (!IS_DEPLOYED) return NextResponse.json({ success: false, error: 'Base Sepolia vault not deployed' }, { status: 503 });
  if (!isAgentAuthorized(request)) {
    return NextResponse.json({ success: false, error: 'Rebalancing is restricted to the protocol agent' }, { status: 401 });
  }
  try {
    const r = await rebalanceFlagship();
    return NextResponse.json({ success: true, data: { rebalanced: true, txHash: r.txHash, timestamp: new Date().toISOString() } });
  } catch (e) {
    console.error('flow rebalance failed', e);
    return NextResponse.json({ success: false, error: 'Rebalance failed' }, { status: 500 });
  }
}
