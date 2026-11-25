/**
 * Network configuration and the tokenized-stock deployment for the active network.
 *
 * NEXT_PUBLIC_NETWORK selects the network: `base-sepolia` (default, testnet) or `base` (mainnet).
 * Addresses come from src/config/deployments/<network>.json, written by `scripts/deploy.mjs`.
 *
 * - base-sepolia: each stock is a B-20 test token that mirrors a Coinbase tokenized stock on Base
 *   mainnet; cash is tUSDC and trades fill through the testnet StockExchange at the oracle NAV.
 * - base: stocks are the real Coinbase tokenized stocks, cash is USDC, and trades go through a real venue.
 */
import sepoliaDeployment from './deployments/base-sepolia.json';
import mainnetDeployment from './deployments/base.json';

export type NetworkKey = 'base' | 'base-sepolia';

const NETWORKS = {
  'base-sepolia': {
    key: 'base-sepolia',
    chainId: 84532,
    name: 'Base Sepolia',
    defaultRpcUrl: 'https://sepolia.base.org',
    blockExplorer: 'https://sepolia.basescan.org',
    explorerName: 'Basescan (Sepolia)',
    testnet: true,
    faucetUrl: 'https://portal.cdp.coinbase.com/onchain-tools/faucet',
  },
  base: {
    key: 'base',
    chainId: 8453,
    name: 'Base',
    defaultRpcUrl: 'https://mainnet.base.org',
    blockExplorer: 'https://basescan.org',
    explorerName: 'Basescan',
    testnet: false,
    faucetUrl: '',
  },
} as const;

const requested = (process.env.NEXT_PUBLIC_NETWORK ?? 'base-sepolia') as NetworkKey;
if (!(requested in NETWORKS)) throw new Error(`NEXT_PUBLIC_NETWORK must be "base" or "base-sepolia", got "${requested}"`);
const net = NETWORKS[requested];

export const IS_TESTNET = net.testnet;
export const IS_MAINNET = !net.testnet;
export const CHAIN_ID = net.chainId;
export const CHAIN_ID_HEX = `0x${net.chainId.toString(16)}`;

/** Public RPC for browser reads. On mainnet set NEXT_PUBLIC_RPC_URL to a paid provider. */
const publicRpc =
  process.env.NEXT_PUBLIC_RPC_URL || (IS_TESTNET ? process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL : undefined) || net.defaultRpcUrl;

export const NETWORK = {
  key: net.key,
  chainId: net.chainId,
  name: net.name,
  rpcUrl: publicRpc,
  blockExplorer: net.blockExplorer,
  explorerName: net.explorerName,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  faucetUrl: net.faucetUrl,
} as const;

/** Server-side RPC (may hold an API key, never exposed to the browser). */
export function serverRpcUrl() {
  return process.env.RPC_URL || (IS_TESTNET ? process.env.BASE_SEPOLIA_RPC_URL : undefined) || NETWORK.rpcUrl;
}

/** Params for wallet_addEthereumChain */
export const WALLET_PARAMS = {
  chainId: CHAIN_ID_HEX,
  chainName: NETWORK.name,
  nativeCurrency: NETWORK.nativeCurrency,
  rpcUrls: [net.defaultRpcUrl],
  blockExplorerUrls: [NETWORK.blockExplorer],
};

export interface Stock {
  symbol: string; // Coinbase symbol, e.g. TSLAc
  testSymbol: string; // display symbol: tTSLAc on testnet, TSLAc on mainnet
  name: string;
  address: string; // token address on the active network
  mainnetAddress: string; // Base mainnet Coinbase token
  decimals: number;
  isin?: string;
  iconUrl?: string;
  multiplier?: number;
  navPrice?: number | null; // Coinbase NAV at creation time (null for stocks without a published NAV)
  navPriceUpdatedAt?: string | null;
  hasNav?: boolean;
  priceUsd?: number; // price at creation time, USD per token
  priceSource?: 'nav' | 'market';
  priceUpdatedAt?: string | null;
}
/** @deprecated use Stock */
export type TestStock = Stock;

interface Deployment {
  network?: string;
  chainId: number;
  explorer: string;
  deployer: string;
  agentWallet: string;
  b20Factory?: string;
  stocks: Stock[];
  cashToken?: { symbol: string; name: string; decimals: number; address: string };
  vault?: { address: string; name: string; symbol: string };
  oracle?: { address: string };
  venue?: { address: string; kind?: 'testnet-exchange' | 'uniswap-v3' };
  factory?: { address: string; implementation?: string; protocolFeeBps?: number };
  basket?: { symbol: string; address: string; weight: number }[];
  deployedAt?: string;
}

export const DEPLOYMENT = (IS_TESTNET ? sepoliaDeployment : mainnetDeployment) as Deployment;
if (DEPLOYMENT.chainId !== CHAIN_ID) {
  throw new Error(`deployments/${net.key}.json is for chain ${DEPLOYMENT.chainId}, expected ${CHAIN_ID}`);
}

export const IS_DEPLOYED = Boolean(DEPLOYMENT.vault?.address && DEPLOYMENT.cashToken?.address);
/** The shared PriceOracle (NAV feed + asset registry) is deployed. */
export const HAS_ORACLE = Boolean(DEPLOYMENT.oracle?.address && DEPLOYMENT.cashToken?.address);
export const ORACLE_ADDRESS = DEPLOYMENT.oracle?.address ?? '';
export const VENUE_ADDRESS = DEPLOYMENT.venue?.address ?? '';
export const FACTORY_ADDRESS = DEPLOYMENT.factory?.address ?? '';
export const STOCKS: Stock[] = DEPLOYMENT.stocks;
export const CASH_TOKEN =
  DEPLOYMENT.cashToken ??
  (IS_TESTNET
    ? { symbol: 'tUSDC', name: 'Test USD Coin', decimals: 6, address: '' }
    : { symbol: 'USDC', name: 'USD Coin', decimals: 6, address: '' });
export const STOCK_VAULT = DEPLOYMENT.vault ?? { address: '', name: 'BEAVII Magnificent 7', symbol: 'bMAG7' };

export function findStock(addressOrSymbol: string): Stock | undefined {
  const k = addressOrSymbol.toLowerCase();
  return STOCKS.find(
    (s) => s.address.toLowerCase() === k || s.symbol.toLowerCase() === k || s.testSymbol.toLowerCase() === k,
  );
}

export function explorerUrl(value: string, type: 'address' | 'tx' | 'token' = 'address') {
  return `${NETWORK.blockExplorer}/${type}/${value}`;
}
