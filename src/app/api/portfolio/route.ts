import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { FACTORY_DEPLOYED, readPortfolio } from '@/lib/etf';

export const dynamic = 'force-dynamic';

/** GET /api/portfolio?account=0x..: the account's ITF positions, the ITFs it manages, and its tUSDC. */
export async function GET(req: NextRequest) {
  const account = req.nextUrl.searchParams.get('account');
  if (!account || !ethers.isAddress(account)) return NextResponse.json({ error: 'account must be an address' }, { status: 400 });
  if (!FACTORY_DEPLOYED) return NextResponse.json({ deployed: false, account, cash: 0, positions: [], managed: [] });
  try {
    return NextResponse.json({ deployed: true, ...(await readPortfolio(ethers.getAddress(account))) });
  } catch (e) {
    console.error('GET /api/portfolio failed', e);
    return NextResponse.json({ error: 'Failed to read your portfolio from Base Sepolia' }, { status: 502 });
  }
}
