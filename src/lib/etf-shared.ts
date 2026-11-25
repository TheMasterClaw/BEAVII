/**
 * ETF constants, types and pure helpers with no ethers dependency, so client components can import them
 * without pulling ethers into the browser bundle. Re-exported from '@/lib/etf' for server code.
 */
import { DEPLOYMENT } from '@/config/base-sepolia';

const dep = DEPLOYMENT as typeof DEPLOYMENT & {
  factory?: { address: string; implementation?: string; protocolFeeBps?: number };
  exchange?: { address: string };
  legacy?: { factory?: { address?: string } }[];
};
export const ETF_FACTORY_ADDRESS = dep.factory?.address ?? '';
/** Retired factories (scripts/migrate-factory.mjs). Their ETFs stay live on the exchange, so keep listing them. */
export const LEGACY_FACTORY_ADDRESSES = (dep.legacy ?? [])
  .map((l) => l.factory?.address ?? '')
  .filter((a) => a && a.toLowerCase() !== ETF_FACTORY_ADDRESS.toLowerCase());
export const STOCK_EXCHANGE_ADDRESS = dep.exchange?.address ?? '';
export const FACTORY_DEPLOYED = Boolean(ETF_FACTORY_ADDRESS);

/** Limits enforced by the contracts (StockBasketVault / ETFFactory constants). */
export const FEE_LIMITS = { managementBps: 500, entryBps: 100, exitBps: 100, timelockDays: 3, maxAssets: 20 } as const;

export interface EtfFees {
  managementFeeBps: number;
  entryFeeBps: number;
  exitFeeBps: number;
}

export interface EtfHolding {
  token: string;
  symbol: string;
  name: string;
  iconUrl?: string;
  targetWeightBps: number;
  actualWeightBps: number;
  balance: string;
  priceUsd: number | null;
  priceAgeSec: number | null;
  valueUsd: number;
}

export interface EtfSummary {
  address: string;
  name: string;
  symbol: string;
  description: string;
  manager: string;
  feeRecipient: string;
  fees: EtfFees;
  protocolFeeBps: number;
  totalValueUsd: number;
  navPerShare: number;
  totalShares: number;
  managerFeesUsd: number;
  protocolFeesUsd: number;
  createdAt: number;
  assetCount: number;
}

export interface EtfDetail extends EtfSummary {
  paused: boolean;
  lastRebalance: number;
  pendingFees: EtfFees | null;
  pendingFeesEta: number;
  accruedFeeShares: number;
  holdings: EtfHolding[];
  account: null | {
    address: string;
    shares: number;
    valueUsd: number;
    cash: number;
    isManager: boolean;
    /** Value of fee shares currently held by this account if it is the fee recipient. */
    feeRecipientValueUsd: number;
  };
}

/** What a manager earns per year at a given AUM (management fee only, after the protocol cut). */
export function estimateManagerYearlyUsd(aumUsd: number, fees: EtfFees, protocolFeeBps: number) {
  return aumUsd * (fees.managementFeeBps / 10_000) * (1 - protocolFeeBps / 10_000);
}

export const bpsToPct = (bps: number, digits = 2) => `${(bps / 100).toFixed(digits)}%`;
