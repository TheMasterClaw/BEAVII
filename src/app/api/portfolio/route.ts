import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { NETWORK } from '@/config/network';
import { FACTORY_DEPLOYED, listPositions } from '@/lib/etf';

export const dynamic = 'force-dynamic';

/** GET /api/portfolio?account=0x..: the account's shares in every ETF, valued at the live NAV. */
export async function GET(req: NextRequest) {
  const account = req.nextUrl.searchParams.get('account');
  if (!account || !ethers.isAddress(account)) return NextResponse.json({ error: 'valid account required' }, { status: 400 });
  if (!FACTORY_DEPLOYED) return NextResponse.json({ deployed: false, positions: [], totalValueUsd: 0 });
  try {
    const positions = await listPositions(ethers.getAddress(account));
    return NextResponse.json({ deployed: true, positions, totalValueUsd: positions.reduce((a, p) => a + p.valueUsd, 0) });
  } catch (e) {
    console.error('GET /api/portfolio failed', e);
    return NextResponse.json({ error: `Failed to read positions from ${NETWORK.name}` }, { status: 502 });
  }
}
