import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { isFactoryEtf, readEtfDetail } from '@/lib/etf';

export const dynamic = 'force-dynamic';

/** GET /api/etfs/:address[?account=0x..]: holdings, fees, manager earnings, and the account's position. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const account = req.nextUrl.searchParams.get('account');
  if (!ethers.isAddress(address)) return NextResponse.json({ error: 'invalid ETF address' }, { status: 400 });
  if (account && !ethers.isAddress(account)) return NextResponse.json({ error: 'invalid account' }, { status: 400 });
  try {
    if (!(await isFactoryEtf(address))) return NextResponse.json({ error: 'not an ETF from this factory' }, { status: 404 });
    return NextResponse.json(await readEtfDetail(ethers.getAddress(address), account));
  } catch (e) {
    console.error('GET /api/etfs/[address] failed', e);
    return NextResponse.json({ error: 'Failed to read ETF from Base Sepolia' }, { status: 502 });
  }
}
