import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { CHAIN_ID, DEPLOYMENT, HAS_ORACLE, IS_DEPLOYED, NETWORK, ORACLE_ADDRESS, STOCK_VAULT } from '@/config/network';
import { getReadProvider, multicall, oracleIface } from '@/lib/stock-vault';
import { isAgentAuthorized } from '@/lib/stock-agent';

export const dynamic = 'force-dynamic';

const MIN_AGENT_BALANCE = ethers.parseEther(process.env.MIN_AGENT_BALANCE_ETH ?? '0.005');

/**
 * GET /api/health: liveness plus the checks worth alerting on. Returns 503 when any check fails so an
 * uptime monitor can page on status alone.
 * - rpc: the RPC answers and is on the expected chain
 * - prices: every flagship holding has a price fresher than its oracle staleness limit
 * - agent: the agent wallet can pay for price pushes and rebalances
 * Detailed results are only returned with the agent bearer secret.
 */
export async function GET(req: NextRequest) {
  const checks: Record<string, { ok: boolean; detail?: unknown }> = {};
  const provider = getReadProvider();

  try {
    const [net, block] = await Promise.all([provider.getNetwork(), provider.getBlock('latest')]);
    const lagSec = block ? Math.floor(Date.now() / 1000) - block.timestamp : null;
    checks.rpc = { ok: Number(net.chainId) === CHAIN_ID && lagSec !== null && lagSec < 120, detail: { chainId: Number(net.chainId), lagSec } };
  } catch (e) {
    checks.rpc = { ok: false, detail: (e as Error).message };
  }

  if (HAS_ORACLE && IS_DEPLOYED) {
    try {
      const basket = DEPLOYMENT.basket ?? [];
      const r = await multicall<bigint>(
        basket.flatMap((b) => [
          { target: ORACLE_ADDRESS, iface: oracleIface, fn: 'priceUpdatedAt', args: [b.address] },
          { target: ORACLE_ADDRESS, iface: oracleIface, fn: 'maxAgeOf', args: [b.address] },
        ]),
      );
      const now = Math.floor(Date.now() / 1000);
      const stale = basket
        .map((b, i) => ({ symbol: b.symbol, ageSec: now - Number(r[i * 2] ?? 0), maxAgeSec: Number(r[i * 2 + 1] ?? 0) }))
        .filter((x) => x.ageSec > x.maxAgeSec);
      checks.prices = { ok: stale.length === 0, detail: { flagship: STOCK_VAULT.address, stale } };
    } catch (e) {
      checks.prices = { ok: false, detail: (e as Error).message };
    }
  }

  if (DEPLOYMENT.agentWallet) {
    try {
      const bal = await provider.getBalance(DEPLOYMENT.agentWallet);
      checks.agent = { ok: bal >= MIN_AGENT_BALANCE, detail: { address: DEPLOYMENT.agentWallet, balanceEth: ethers.formatEther(bal) } };
    } catch (e) {
      checks.agent = { ok: false, detail: (e as Error).message };
    }
  }

  const ok = Object.values(checks).every((c) => c.ok);
  const verbose = isAgentAuthorized(req);
  const body = {
    ok,
    network: NETWORK.key,
    checks: Object.fromEntries(Object.entries(checks).map(([k, v]) => [k, verbose ? v : { ok: v.ok }])),
  };
  return NextResponse.json(body, { status: ok ? 200 : 503 });
}
