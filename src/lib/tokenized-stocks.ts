/**
 * Coinbase Tokenized Stocks API client (read-only, no key).
 * Docs: https://docs.base.org/sdks/tokenized-stocks/overview
 * Records describe the real tokens on Base mainnet; we use them for live NAV, icons and metadata.
 */
export const TOKENIZED_STOCKS_API = 'https://api.coinbase.com/v1/tokenized-stocks';

export interface TokenizedStockRecord {
  contract_address: string;
  symbol: string;
  name: string;
  description?: string;
  decimals: number;
  isin?: string;
  adgm_isin?: string;
  multiplier: number;
  icon_url?: string;
  total_supply?: number;
  paused_features?: string[] | null;
  nav_price?: number | null;
  nav_price_updated_at?: string | null;
  first_mint_date?: string;
}

/** Fetches every token record (follows pagination). Cached by Next for `revalidate` seconds. */
export async function fetchTokenizedStocks(revalidate = 60): Promise<TokenizedStockRecord[]> {
  const out: TokenizedStockRecord[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < 10; i++) {
    const url = new URL(TOKENIZED_STOCKS_API);
    url.searchParams.set('page_size', '500');
    if (pageToken) url.searchParams.set('page_token', pageToken);
    const res = await fetch(url, { next: { revalidate } });
    if (!res.ok) throw new Error(`Tokenized Stocks API ${res.status}`);
    const body = (await res.json()) as { tokens: TokenizedStockRecord[]; next_page_token?: string };
    out.push(...(body.tokens ?? []));
    if (!body.next_page_token) break;
    pageToken = body.next_page_token;
  }
  return out;
}

/** symbol (e.g. "TSLAc") -> NAV in USD per token. Only tokens with a published NAV. */
export async function fetchNavPrices(revalidate = 60): Promise<Record<string, { price: number; updatedAt?: string }>> {
  const tokens = await fetchTokenizedStocks(revalidate);
  return Object.fromEntries(
    tokens
      .filter((t) => t.nav_price && t.nav_price > 0)
      .map((t) => [t.symbol, { price: Number(t.nav_price), updatedAt: t.nav_price_updated_at ?? undefined }]),
  );
}
