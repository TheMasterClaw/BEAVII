import { NextResponse } from 'next/server';
import { NETWORK } from '@/config/network';
import { FACTORY_DEPLOYED, readProtocolAnalytics } from '@/lib/etf';

export const dynamic = 'force-dynamic';

/** GET /api/analytics: live AUM, fees and combined stock exposure across every ETF. */
export async function GET() {
  if (!FACTORY_DEPLOYED) return NextResponse.json({ deployed: false });
  try {
    return NextResponse.json({ deployed: true, ...(await readProtocolAnalytics()) });
  } catch (e) {
    console.error('GET /api/analytics failed', e);
    return NextResponse.json({ error: `Failed to read analytics from ${NETWORK.name}` }, { status: 502 });
  }
}
