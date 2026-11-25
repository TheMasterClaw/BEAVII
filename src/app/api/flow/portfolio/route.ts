import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { BASE_SEPOLIA, IS_DEPLOYED, findStock } from '@/config/base-sepolia';
import { getStockVault } from '@/lib/stock-vault';

export const dynamic = 'force-dynamic';

/** Portfolio of the Base Sepolia tokenized-stock vault, in the shape the ITF dashboard expects. */
export async function GET() {
  if (!IS_DEPLOYED) {
    return NextResponse.json({ success: false, error: 'Base Sepolia vault not deployed (run scripts/deploy-base-sepolia.mjs)' }, { status: 503 });
  }
  try {
    const vault = getStockVault();
    const [holdings, totalValue, nav, supply, lastRebalance] = await Promise.all([
      vault.getHoldings(),
      vault.getTotalValue(),
      vault.getNetAssetValue(),
      vault.totalSupply(),
      vault.lastRebalanceTime(),
    ]);
    const total = Number(ethers.formatEther(totalValue));
    let maxDriftBps = 0;
    const tokens = holdings
      .filter((h: { targetWeight: bigint; balance: bigint }) => h.targetWeight > BigInt(0) || h.balance > BigInt(0))
      .map((h: { token: string; targetWeight: bigint; balance: bigint; price: bigint; valueUsd: bigint; decimals: bigint }) => {
        const stock = findStock(h.token);
        const value = Number(ethers.formatEther(h.valueUsd));
        const actualBps = total > 0 ? (value / total) * 10_000 : 0;
        maxDriftBps = Math.max(maxDriftBps, Math.abs(actualBps - Number(h.targetWeight)));
        return {
          chainId: BASE_SEPOLIA.chainId,
          tokenAddress: h.token,
          tokenSymbol: stock?.testSymbol ?? 'Unknown',
          name: stock?.name,
          weight: Number(h.targetWeight) / 100,
          actualWeight: actualBps / 100,
          amount: ethers.formatUnits(h.balance, Number(h.decimals)),
          price: Number(ethers.formatUnits(h.price, 8)),
          valueUSD: value,
          logoUrl: stock?.iconUrl ?? '/file.svg',
        };
      });

    return NextResponse.json({
      success: true,
      data: {
        itfId: 'base-sepolia-stocks',
        totalValueUSD: total,
        navPerShare: Number(ethers.formatEther(nav)),
        totalSupply: ethers.formatEther(supply),
        tokens,
        lastRebalance: Number(lastRebalance) ? new Date(Number(lastRebalance) * 1000).toISOString() : null,
        priceSource: 'Coinbase Tokenized Stocks NAV (pushed onchain)',
        needsRebalancing: maxDriftBps > 100, // >1% drift from target
        maxDriftBps: Math.round(maxDriftBps),
      },
    });
  } catch (error) {
    console.error('Error fetching stock vault portfolio:', error);
    return NextResponse.json({ success: false, error: 'Failed to read Base Sepolia vault' }, { status: 502 });
  }
}
