import { NextRequest, NextResponse } from 'next/server';
import { getListings, getQuotes } from '@/lib/coinmarketcap';

/**
 * GET /api/market?symbols=BTC,ETH   -> latest USD quotes for those symbols
 * GET /api/market?limit=50          -> top coins by market cap (default 100, max 500)
 * Data: CoinMarketCap Pro API, cached ~60s.
 */
export async function GET(req: NextRequest) {
  const symbolsParam = req.nextUrl.searchParams.get('symbols');
  try {
    if (symbolsParam) {
      const symbols = symbolsParam
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter((s) => /^[A-Z0-9]{1,15}$/.test(s))
        .slice(0, 100);
      if (!symbols.length) return NextResponse.json({ error: 'invalid symbols' }, { status: 400 });
      return NextResponse.json({ source: 'coinmarketcap', quotes: await getQuotes(symbols) });
    }
    const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get('limit')) || 100, 1), 500);
    return NextResponse.json({ source: 'coinmarketcap', listings: await getListings(limit) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
