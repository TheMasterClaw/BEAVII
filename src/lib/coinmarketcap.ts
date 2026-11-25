/** Server-only CoinMarketCap Pro API client. Reads CMC_API_KEY from the environment; never import from client components. */

const CMC_BASE = 'https://pro-api.coinmarketcap.com';

export interface CmcQuote {
  id: number;
  symbol: string;
  name: string;
  slug: string;
  cmcRank: number | null;
  price: number;
  marketCap: number;
  volume24h: number;
  percentChange1h: number;
  percentChange24h: number;
  percentChange7d: number;
  circulatingSupply: number | null;
  lastUpdated: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toQuote(c: any): CmcQuote {
  const q = c.quote?.USD ?? {};
  return {
    id: c.id,
    symbol: c.symbol,
    name: c.name,
    slug: c.slug,
    cmcRank: c.cmc_rank ?? null,
    price: q.price,
    marketCap: q.market_cap,
    volume24h: q.volume_24h,
    percentChange1h: q.percent_change_1h,
    percentChange24h: q.percent_change_24h,
    percentChange7d: q.percent_change_7d,
    circulatingSupply: c.circulating_supply ?? null,
    lastUpdated: q.last_updated,
  };
}

async function cmcFetch(path: string, params: Record<string, string>, revalidate: number) {
  const key = process.env.CMC_API_KEY;
  if (!key) throw new Error('CMC_API_KEY is not set');
  const url = `${CMC_BASE}${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url, {
    headers: { 'X-CMC_PRO_API_KEY': key, Accept: 'application/json' },
    next: { revalidate },
  } as RequestInit);
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.status?.error_code) {
    throw new Error(`CoinMarketCap ${res.status}: ${body?.status?.error_message ?? 'request failed'}`);
  }
  return body.data;
}

/** Latest USD quotes for the given symbols (e.g. ['BTC','ETH']). Picks the top-ranked match per symbol. */
export async function getQuotes(symbols: string[], revalidate = 60): Promise<Record<string, CmcQuote>> {
  const data = await cmcFetch('/v2/cryptocurrency/quotes/latest', { symbol: symbols.join(','), convert: 'USD' }, revalidate);
  const out: Record<string, CmcQuote> = {};
  for (const [sym, entries] of Object.entries(data ?? {})) {
    const list = (entries as unknown[]).filter(Boolean);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const best = list.sort((a: any, b: any) => (a.cmc_rank ?? 1e9) - (b.cmc_rank ?? 1e9))[0];
    if (best) out[sym] = toQuote(best);
  }
  return out;
}

/** Top coins by market cap. */
export async function getListings(limit = 100, revalidate = 60): Promise<CmcQuote[]> {
  const data = await cmcFetch('/v1/cryptocurrency/listings/latest', { start: '1', limit: String(limit), convert: 'USD' }, revalidate);
  return (data ?? []).map(toQuote);
}
