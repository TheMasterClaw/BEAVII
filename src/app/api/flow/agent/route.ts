import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { DEPLOYMENT } from '@/config/base-sepolia';
import { getServerProvider } from '@/lib/flow-contracts-server';

export const dynamic = 'force-dynamic';

/** Agent wallet status for the Base Sepolia stock vault. Operation history is demo data. */
export async function GET() {
  const agentWallet = DEPLOYMENT.agentWallet;
  let balance = '0';
  try {
    if (agentWallet) balance = Number(ethers.formatEther(await getServerProvider().getBalance(agentWallet))).toFixed(4);
  } catch (error) {
    console.error('Error fetching agent balance on Base Sepolia:', error);
  }

  const mockOperations = [
    {
      id: '0x' + Math.random().toString(16).slice(2),
      type: 'Rebalance',
      timestamp: new Date().toISOString(),
      targetToken: 'tNVDAc',
      amount: '25',
      status: 'completed',
      txHash: '0x' + Math.random().toString(16).slice(2),
    },
    {
      id: '0x' + Math.random().toString(16).slice(2),
      type: 'NAV Price Sync',
      timestamp: new Date(Date.now() - 1800000).toISOString(),
      targetToken: 'tAAPLc',
      amount: '0',
      status: 'completed',
      txHash: '0x' + Math.random().toString(16).slice(2),
    },
  ];

  return NextResponse.json({
    success: Boolean(agentWallet),
    data: {
      address: agentWallet,
      isAuthorized: Boolean(agentWallet),
      balance: `${balance} ETH`,
      totalOperations: mockOperations.length,
      lastOperation: new Date().toISOString(),
      status: agentWallet ? 'active' : 'inactive',
      operations: mockOperations,
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const { action, agent, authorized } = await request.json();
    if (!action) {
      return NextResponse.json({ success: false, error: 'Missing required parameter: action' }, { status: 400 });
    }
    // Simulated: the vault agent is set at deploy time (scripts/deploy-base-sepolia.mjs).
    if (action === 'setAgent' && agent) {
      return NextResponse.json({
        success: true,
        data: { txHash: `0x${Math.random().toString(16).slice(2)}`, action, agent, timestamp: new Date().toISOString() },
      });
    }
    if (action === 'authorize' && agent) {
      return NextResponse.json({
        success: true,
        data: { txHash: `0x${Math.random().toString(16).slice(2)}`, action, agent, authorized, timestamp: new Date().toISOString() },
      });
    }
    return NextResponse.json({ success: false, error: `Unsupported action: ${action}` }, { status: 400 });
  } catch (error) {
    console.error('Error processing agent action:', error);
    return NextResponse.json({ success: false, error: 'Failed to process agent action' }, { status: 500 });
  }
}
