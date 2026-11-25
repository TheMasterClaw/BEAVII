import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { DEPLOYMENT, EXCHANGE_ADDRESS } from '@/config/base-sepolia';
import { getBaseSepoliaProvider } from '@/lib/stock-vault';
import { readEtfDetail } from '@/lib/etf';

export const dynamic = 'force-dynamic';

const AGENT_ABI = ['function authorizedAgents(address) view returns (bool)', 'function maxPriceAge() view returns (uint256)'];

/**
 * Onchain status of the protocol agent (the key that syncs NAV prices and rebalances the flagship).
 * Everything here is read from Base Sepolia; there is no simulated data.
 */
export async function GET() {
  const agent = DEPLOYMENT.agentWallet;
  if (!agent) return NextResponse.json({ configured: false });
  const provider = getBaseSepoliaProvider();
  const flagship = DEPLOYMENT.vault?.address;
  try {
    const exchange = EXCHANGE_ADDRESS ? new ethers.Contract(EXCHANGE_ADDRESS, AGENT_ABI, provider) : null;
    const [balance, nonce, onExchange, maxPriceAge, onFlagship, detail] = await Promise.all([
      provider.getBalance(agent),
      provider.getTransactionCount(agent),
      exchange ? exchange.authorizedAgents(agent) : Promise.resolve(null),
      exchange ? exchange.maxPriceAge() : Promise.resolve(null),
      flagship ? new ethers.Contract(flagship, AGENT_ABI, provider).authorizedAgents(agent) : Promise.resolve(null),
      flagship ? readEtfDetail(flagship).catch(() => null) : Promise.resolve(null),
    ]);
    const ages = (detail?.holdings ?? []).map((h) => h.priceAgeSec).filter((a): a is number => a != null);
    return NextResponse.json({
      configured: true,
      address: agent,
      balanceEth: Number(ethers.formatEther(balance)),
      transactions: nonce,
      authorizedOnExchange: onExchange,
      authorizedOnFlagship: onFlagship,
      maxPriceAgeSec: maxPriceAge == null ? null : Number(maxPriceAge),
      flagship: detail
        ? { address: detail.address, symbol: detail.symbol, lastRebalance: detail.lastRebalance, stalestPriceSec: ages.length ? Math.max(...ages) : null }
        : null,
    });
  } catch (e) {
    console.error('GET /api/flow/agent failed', e);
    return NextResponse.json({ configured: true, address: agent, error: 'Could not read the agent from Base Sepolia' }, { status: 502 });
  }
}
