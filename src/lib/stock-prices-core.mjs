// Prices for every Coinbase tokenized stock on Base. Plain JS so Node scripts and Next.js share it.
//   1. Coinbase Tokenized Stocks API NAV (official, per token) when published
//   2. otherwise the underlying's market price (Yahoo Finance spark, keyless) x the token multiplier
// All prices are USD per whole token.

export const TOKENIZED_STOCKS_API = 'https://api.coinbase.com/v1/tokenized-stocks';
const SPARK_URL = 'https://query1.finance.yahoo.com/v7/finance/spark';
const SPARK_BATCH = 20; // Yahoo returns at most ~20 symbols per spark request

/** Coinbase symbol ("BRK.Bc") -> Yahoo ticker ("BRK-B"). */
export function underlyingTicker(symbol) {
  return symbol.replace(/c$/, '').replace(/\./g, '-');
}

export async function fetchTokenRecords({ fetchImpl = fetch, init } = {}) {
  const out = [];
  let pageToken;
  for (let i = 0; i < 10; i++) {
    const url = new URL(TOKENIZED_STOCKS_API);
    url.searchParams.set('page_size', '500');
    if (pageToken) url.searchParams.set('page_token', pageToken);
    const res = await fetchImpl(url, init);
    if (!res.ok) throw new Error(`Tokenized Stocks API ${res.status}`);
    const body = await res.json();
    out.push(...(body.tokens ?? []));
    if (!body.next_page_token) break;
    pageToken = body.next_page_token;
  }
  return out;
}

/** ticker -> { price, time (unix s), currency } via Yahoo spark, batched and run with limited concurrency. */
export async function fetchMarketPrices(tickers, { fetchImpl = fetch, init, concurrency = 4 } = {}) {
  const batches = [];
  for (let i = 0; i < tickers.length; i += SPARK_BATCH) batches.push(tickers.slice(i, i + SPARK_BATCH));
  const out = {};
  let next = 0;
  async function worker() {
    while (next < batches.length) {
      const batch = batches[next++];
      const url = `${SPARK_URL}?symbols=${encodeURIComponent(batch.join(','))}&range=1d&interval=1d`;
      try {
        const res = await fetchImpl(url, { ...init, headers: { 'User-Agent': 'Mozilla/5.0', ...(init?.headers ?? {}) } });
        if (!res.ok) continue;
        const body = await res.json();
        for (const r of body?.spark?.result ?? []) {
          const m = r?.response?.[0]?.meta;
          if (m?.regularMarketPrice > 0 && m.currency === 'USD') {
            out[r.symbol] = { price: m.regularMarketPrice, time: m.regularMarketTime, name: m.longName ?? m.shortName };
          }
        }
      } catch {
        /* one failed batch should not sink the rest */
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));
  return out;
}

/**
 * symbol -> { price, source: 'nav' | 'market', updatedAt, multiplier }
 * NAV wins when present (it is the issuer's official per-token value); otherwise market x multiplier.
 */
export async function fetchAllStockPrices(opts = {}) {
  const records = opts.records ?? (await fetchTokenRecords(opts));
  const market = await fetchMarketPrices(records.map((r) => underlyingTicker(r.symbol)), opts);
  const prices = {};
  for (const r of records) {
    const multiplier = Number(r.multiplier) || 1;
    if (r.nav_price > 0) {
      prices[r.symbol] = { price: Number(r.nav_price), source: 'nav', updatedAt: r.nav_price_updated_at ?? null, multiplier };
      continue;
    }
    const m = market[underlyingTicker(r.symbol)];
    if (m) {
      prices[r.symbol] = {
        price: m.price * multiplier,
        source: 'market',
        updatedAt: m.time ? new Date(m.time * 1000).toISOString() : null,
        multiplier,
      };
    }
  }
  return { records, prices };
}
