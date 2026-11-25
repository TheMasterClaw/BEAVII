import { NextRequest, NextResponse } from 'next/server';
import { getListings, getQuotes } from '@/lib/coinmarketcap';

const MAX_SYMBOLS = 50;
const LIMITS = [10, 25, 50, 100, 200] as const;

/**
 * GET /api/market?symbols=BTC,ETH   -> latest USD quotes for those symbols (max 50)
 * GET /api/market?limit=50          -> top coins by market cap (10, 25, 50, 100 or 200; default 100)
 * Data: CoinMarketCap Pro API, cached ~60s. Inputs are normalized (sorted, de-duplicated, fixed limits) so callers
 * can't mint a fresh cache key, and a fresh paid CMC call, per request (audit F-07).
 */
export async function GET(req: NextRequest) {
  const symbolsParam = req.nextUrl.searchParams.get('symbols');
  try {
    if (symbolsParam) {
      const symbols = [...new Set(symbolsParam.split(',').map((s) => s.trim().toUpperCase()))]
        .filter((s) => /^[A-Z0-9]{1,15}$/.test(s))
        .sort();
      if (!symbols.length) return NextResponse.json({ error: 'invalid symbols' }, { status: 400 });
      if (symbols.length > MAX_SYMBOLS) return NextResponse.json({ error: `at most ${MAX_SYMBOLS} symbols` }, { status: 400 });
      return NextResponse.json({ source: 'coinmarketcap', quotes: await getQuotes(symbols) });
    }
    const requested = Number(req.nextUrl.searchParams.get('limit')) || 100;
    const limit = LIMITS.find((l) => l >= requested) ?? LIMITS[LIMITS.length - 1];
    return NextResponse.json({ source: 'coinmarketcap', listings: await getListings(limit) });
  } catch (err) {
    console.error('GET /api/market failed', err);
    return NextResponse.json({ error: 'Market data unavailable' }, { status: 502 });
  }
}
