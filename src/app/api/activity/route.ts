import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { NETWORK } from '@/config/network';
import { FACTORY_DEPLOYED, readActivity } from '@/lib/etf';

export const dynamic = 'force-dynamic';

/** GET /api/activity?account=0x..: the account's ETF deposits, redemptions and launches, from event logs. */
export async function GET(req: NextRequest) {
  const account = req.nextUrl.searchParams.get('account');
  if (!account || !ethers.isAddress(account)) return NextResponse.json({ error: 'valid account required' }, { status: 400 });
  if (!FACTORY_DEPLOYED) return NextResponse.json({ deployed: false, activity: [] });
  try {
    return NextResponse.json({ deployed: true, activity: await readActivity(ethers.getAddress(account)) });
  } catch (e) {
    console.error('GET /api/activity failed', e);
    return NextResponse.json({ error: `Failed to read activity from ${NETWORK.name}` }, { status: 502 });
  }
}
