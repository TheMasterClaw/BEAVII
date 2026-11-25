export const TOKENIZED_STOCKS_API: string;
export function underlyingTicker(symbol: string): string;
export function fetchTokenRecords(opts?: { fetchImpl?: typeof fetch; init?: RequestInit }): Promise<any[]>;
export function fetchMarketPrices(tickers: string[], opts?: { fetchImpl?: typeof fetch; init?: RequestInit; concurrency?: number }): Promise<Record<string, { price: number; time: number; name?: string }>>;
export function fetchAllStockPrices(opts?: { fetchImpl?: typeof fetch; init?: RequestInit; records?: any[]; concurrency?: number }): Promise<{ records: any[]; prices: Record<string, { price: number; source: 'nav' | 'market'; updatedAt: string | null; multiplier: number }> }>;
