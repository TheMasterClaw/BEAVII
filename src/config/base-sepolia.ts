/**
 * Base Sepolia (chain 84532) configuration and the tokenized-stock deployment.
 *
 * Addresses come from src/config/deployments/base-sepolia.json, written by
 * `node scripts/deploy-base-sepolia.mjs`. Each test stock is a B-20 Asset token that mirrors a
 * Coinbase tokenized stock on Base mainnet (same name, decimals and ISIN, priced at its live NAV).
 */
import deployment from './deployments/base-sepolia.json';

export const BASE_SEPOLIA_CHAIN_ID = 84532;
export const BASE_SEPOLIA_CHAIN_ID_HEX = '0x14a34';

export const BASE_SEPOLIA = {
  chainId: BASE_SEPOLIA_CHAIN_ID,
  name: 'Base Sepolia',
  rpcUrl: process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org',
  blockExplorer: 'https://sepolia.basescan.org',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  faucetUrl: 'https://portal.cdp.coinbase.com/onchain-tools/faucet',
} as const;

/** Params for wallet_addEthereumChain */
export const BASE_SEPOLIA_WALLET_PARAMS = {
  chainId: BASE_SEPOLIA_CHAIN_ID_HEX,
  chainName: BASE_SEPOLIA.name,
  nativeCurrency: BASE_SEPOLIA.nativeCurrency,
  rpcUrls: ['https://sepolia.base.org'],
  blockExplorerUrls: [BASE_SEPOLIA.blockExplorer],
};

export interface TestStock {
  symbol: string; // mainnet Coinbase symbol, e.g. TSLAc
  testSymbol: string; // tTSLAc
  name: string;
  address: string; // Base Sepolia B-20 address
  mainnetAddress: string; // Base mainnet Coinbase token
  decimals: number;
  isin?: string;
  iconUrl?: string;
  multiplier?: number;
  navPrice?: number | null; // Coinbase NAV at creation time (null for the ~400 stocks without a published NAV)
  navPriceUpdatedAt?: string | null;
  hasNav?: boolean;
  priceUsd?: number; // price at creation time, USD per token
  priceSource?: 'nav' | 'market';
  priceUpdatedAt?: string | null;
}

interface Deployment {
  chainId: number;
  explorer: string;
  deployer: string;
  agentWallet: string;
  b20Factory: string;
  stocks: TestStock[];
  cashToken?: { symbol: string; name: string; decimals: number; address: string };
  vault?: { address: string; name: string; symbol: string };
  exchange?: { address: string };
  factory?: { address: string; implementation?: string };
  basket?: { symbol: string; address: string; weight: number }[];
  deployedAt?: string;
}

export const DEPLOYMENT = deployment as Deployment;
export const IS_DEPLOYED = Boolean(DEPLOYMENT.vault?.address && DEPLOYMENT.cashToken?.address);
/** Stock tokens exist and the shared StockExchange (price feed + issuer) is deployed. */
export const HAS_EXCHANGE = Boolean(DEPLOYMENT.exchange?.address && DEPLOYMENT.cashToken?.address);
export const EXCHANGE_ADDRESS = DEPLOYMENT.exchange?.address ?? '';
export const FACTORY_ADDRESS = DEPLOYMENT.factory?.address ?? '';
export const STOCKS: TestStock[] = DEPLOYMENT.stocks;
export const CASH_TOKEN = DEPLOYMENT.cashToken ?? { symbol: 'tUSDC', name: 'Test USD Coin', decimals: 6, address: '' };
export const STOCK_VAULT = DEPLOYMENT.vault ?? { address: '', name: 'BEAVII Magnificent 7', symbol: 'bMAG7' };

export function findStock(addressOrSymbol: string): TestStock | undefined {
  const k = addressOrSymbol.toLowerCase();
  return STOCKS.find(
    (s) => s.address.toLowerCase() === k || s.symbol.toLowerCase() === k || s.testSymbol.toLowerCase() === k,
  );
}

export function explorerUrl(value: string, type: 'address' | 'tx' | 'token' = 'address') {
  return `${BASE_SEPOLIA.blockExplorer}/${type}/${value}`;
}
