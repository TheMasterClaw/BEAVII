import { unstable_cache } from 'next/cache';

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

/** revalidate = 0 skips Next's fetch cache (for large raw responses that get cached after processing). */
async function cmcFetch(path: string, params: Record<string, string>, revalidate: number) {
  const key = process.env.CMC_API_KEY;
  if (!key) throw new Error('CMC_API_KEY is not set');
  const url = `${CMC_BASE}${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url, {
    headers: { 'X-CMC_PRO_API_KEY': key, Accept: 'application/json' },
    ...(revalidate > 0 ? { next: { revalidate } } : { cache: 'no-store' }),
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

// --- Tokenized stocks on Base --------------------------------------------------

const TOKENIZED_STOCK_CATEGORY = '604f2767ebccdd50cd175fd0'; // CMC "Tokenized Stock"

export interface BaseTokenizedStock extends CmcQuote {
  baseAddress: string; // lowercase
  issuer: 'Coinbase' | 'Dinari' | 'Backed' | 'Other';
}

interface BaseListing {
  id: number;
  baseAddress: string;
}

function issuerOf(name: string, address: string): BaseTokenizedStock['issuer'] {
  if (address.startsWith('0xb2000000000000000000')) return 'Coinbase';
  if (/\(Dinari\)/i.test(name)) return 'Dinari';
  if (/\(Backed\)/i.test(name)) return 'Backed';
  return 'Other';
}

/** CMC ids in the Tokenized Stock category that have a Base contract. Rebuilt daily (~35 credits). */
const getBaseListings = unstable_cache(
  async (): Promise<BaseListing[]> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const coins: any[] = [];
    for (let start = 1; start < 10_000; start += 1000) {
      const page = await cmcFetch('/v1/cryptocurrency/category', { id: TOKENIZED_STOCK_CATEGORY, start: String(start), limit: '1000' }, 0);
      coins.push(...(page?.coins ?? []));
      if (coins.length >= (page?.num_tokens ?? 0) || !page?.coins?.length) break;
    }

    const out = new Map<number, string>();
    for (const c of coins) if (c.platform?.slug === 'base' || c.platform?.name === 'Base') out.set(c.id, c.platform.token_address.toLowerCase());

    // Multi-chain tokens only list their primary chain above; /info has every deployment.
    const ids = coins.map((c) => c.id);
    for (let i = 0; i < ids.length; i += 200) {
      const info = await cmcFetch('/v2/cryptocurrency/info', { id: ids.slice(i, i + 200).join(','), skip_invalid: 'true', aux: 'platform' }, 0);
      for (const [id, meta] of Object.entries(info ?? {})) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const base = ((meta as any).contract_address ?? []).find((x: any) => x.platform?.coin?.slug === 'base' || x.platform?.name === 'Base');
        if (base?.contract_address && !out.has(Number(id))) out.set(Number(id), base.contract_address.toLowerCase());
      }
    }
    return [...out].map(([id, baseAddress]) => ({ id, baseAddress }));
  },
  ['cmc-base-tokenized-listings'],
  { revalidate: 86_400 },
);

/** Every CMC-tracked tokenized stock deployed on Base, with live USD quotes, sorted by market cap. Quotes refresh every 30 min (~3 credits). */
export const getBaseTokenizedStocks = unstable_cache(
  async (): Promise<BaseTokenizedStock[]> => {
    const listings = await getBaseListings();
    const addr = new Map(listings.map((l) => [l.id, l.baseAddress]));
    const out: BaseTokenizedStock[] = [];
    for (let i = 0; i < listings.length; i += 100) {
      const ids = listings.slice(i, i + 100).map((l) => l.id).join(',');
      const data = await cmcFetch('/v2/cryptocurrency/quotes/latest', { id: ids, convert: 'USD', skip_invalid: 'true' }, 0);
      for (const c of Object.values(data ?? {})) {
        const q = toQuote(c);
        const baseAddress = addr.get(q.id)!;
        out.push({ ...q, baseAddress, issuer: issuerOf(q.name, baseAddress) });
      }
    }
    return out.sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0));
  },
  ['cmc-base-tokenized-quotes'],
  { revalidate: 1_800 },
);
