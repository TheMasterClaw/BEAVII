import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { ETF_FACTORY_ADDRESS, FACTORY_DEPLOYED, getEtfFactory, listEtfs } from '@/lib/etf';

export const dynamic = 'force-dynamic';

/** GET /api/etfs[?manager=0x..]: every user-created ETF (newest first), or only one manager's. */
export async function GET(req: NextRequest) {
  const manager = req.nextUrl.searchParams.get('manager');
  if (manager && !ethers.isAddress(manager)) return NextResponse.json({ error: 'invalid manager address' }, { status: 400 });
  if (!FACTORY_DEPLOYED) return NextResponse.json({ deployed: false, factory: null, etfs: [] });
  try {
    const [etfs, protocolFeeBps] = await Promise.all([listEtfs(manager), getEtfFactory().protocolFeeBps()]);
    return NextResponse.json({ deployed: true, factory: ETF_FACTORY_ADDRESS, protocolFeeBps: Number(protocolFeeBps), etfs });
  } catch (e) {
    console.error('GET /api/etfs failed', e);
    return NextResponse.json({ error: 'Failed to read ETFs from Base Sepolia' }, { status: 502 });
  }
}
