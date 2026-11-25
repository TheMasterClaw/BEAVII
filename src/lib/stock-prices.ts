/** Typed wrapper around stock-prices-core.mjs (shared with the Node deploy scripts). */
import { fetchAllStockPrices as core, underlyingTicker } from './stock-prices-core.mjs';
import type { TokenizedStockRecord } from './tokenized-stocks';

export interface StockPrice {
  price: number; // USD per whole token
  source: 'nav' | 'market';
  updatedAt: string | null;
  multiplier: number;
}

export { underlyingTicker };

/** Live prices for every Coinbase tokenized stock. Cached by Next for `revalidate` seconds. */
export async function fetchAllStockPrices(revalidate = 60): Promise<{ records: TokenizedStockRecord[]; prices: Record<string, StockPrice> }> {
  return core({ init: { next: { revalidate } } as RequestInit });
}
