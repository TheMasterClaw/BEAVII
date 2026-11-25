'use client';

import { useEffect, useState } from 'react';
import { getStockExchange, STOCK_EXCHANGE_ADDRESS } from '@/lib/etf';

/**
 * Lowercased addresses the StockExchange currently lists (an ITF can only hold these).
 * `null` while loading or if the read fails; callers then allow every stock and let the contract decide.
 */
export function useListedStocks() {
  const [listed, setListed] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (!STOCK_EXCHANGE_ADDRESS) return;
    let live = true;
    getStockExchange()
      .getListedTokens()
      .then((a: string[]) => live && setListed(new Set(a.map((x) => x.toLowerCase()))))
      .catch((e: unknown) => console.warn('Could not read listed stocks', e));
    return () => {
      live = false;
    };
  }, []);
  return listed;
}
