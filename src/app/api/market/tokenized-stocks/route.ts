import { NextRequest, NextResponse } from 'next/server';
import { getBaseTokenizedStocks } from '@/lib/coinmarketcap';

export const dynamic = 'force-dynamic';

/**
 * GET /api/market/tokenized-stocks[?issuer=Coinbase|Dinari|Backed][&active=1]
 * Tokenized stocks deployed on Base mainnet, per CoinMarketCap (price, market cap, volume, % change, Base address).
 * active=1 drops tokens with no market cap. Quotes cached ~30 min, the token list ~24 h.
 */
export async function GET(req: NextRequest) {
  const issuer = req.nextUrl.searchParams.get('issuer');
  const active = req.nextUrl.searchParams.get('active') === '1';
  try {
    let tokens = await getBaseTokenizedStocks();
    if (issuer) tokens = tokens.filter((t) => t.issuer.toLowerCase() === issuer.toLowerCase());
    if (active) tokens = tokens.filter((t) => t.marketCap > 0);
    const totals = tokens.reduce((a, t) => ({ marketCap: a.marketCap + (t.marketCap || 0), volume24h: a.volume24h + (t.volume24h || 0) }), { marketCap: 0, volume24h: 0 });
    return NextResponse.json({ source: 'coinmarketcap', chain: 'base', count: tokens.length, totals, tokens });
  } catch (err) {
    console.error('GET /api/market/tokenized-stocks failed', err);
    return NextResponse.json({ error: 'Market data unavailable' }, { status: 502 });
  }
}
