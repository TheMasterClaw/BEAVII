import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { navHistory } from '@/lib/nav-history/store';

export const dynamic = 'force-dynamic';

const MAX_ETFS = 10;
const MAX_DAYS = 365;

/**
 * GET /api/nav-history?etf=0x..&etf=0x..&days=90
 * -> { enabled, history: { [etf]: [{ t, nav, aum }] } }  (t = unix seconds, oldest first)
 * History only changes after a price sync, so responses are cached at the edge for a few minutes.
 */
export async function GET(req: NextRequest) {
  const etfs = [...new Set(req.nextUrl.searchParams.getAll('etf').map((a) => a.toLowerCase()))];
  if (!etfs.length || etfs.length > MAX_ETFS || !etfs.every((a) => ethers.isAddress(a))) {
    return NextResponse.json({ error: `etf must be 1-${MAX_ETFS} vault addresses` }, { status: 400 });
  }
  const days = Math.min(MAX_DAYS, Math.max(1, Number(req.nextUrl.searchParams.get('days')) || 90));
  const from = Math.floor(Date.now() / 1000) - days * 86_400;
  try {
    const lists = await Promise.all(etfs.map((a) => navHistory.range(a, from)));
    const history = Object.fromEntries(etfs.map((a, i) => [a, lists[i].map(({ t, nav, aum }) => ({ t, nav, aum }))]));
    return NextResponse.json(
      { enabled: navHistory.enabled(), history },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600' } },
    );
  } catch (e) {
    console.error('GET /api/nav-history failed', e);
    return NextResponse.json({ error: 'Failed to read price history' }, { status: 502 });
  }
}
