/**
 * Contract addresses and network configuration. Primary network: Base Sepolia (84532).
 * Source of truth: src/config/deployments/base-sepolia.json (see scripts/deploy-base-sepolia.mjs).
 */
import { BASE_SEPOLIA, CASH_TOKEN, DEPLOYMENT, STOCKS, STOCK_VAULT } from './base-sepolia';

export const PRIMARY_CHAIN_ID = BASE_SEPOLIA.chainId;

export const CONTRACT_ADDRESSES = {
  etfVault: STOCK_VAULT.address,
  b20Factory: DEPLOYMENT.b20Factory,
  agentWallet: DEPLOYMENT.agentWallet,
} as const;

/** Symbol -> address for the cash token (as USDC) and every test stock (by test symbol, e.g. tTSLAc). */
export const ASSET_ADDRESSES: Record<string, string> = {
  USDC: CASH_TOKEN.address,
  ...Object.fromEntries(STOCKS.map((s) => [s.testSymbol, s.address])),
};

export const NETWORK_CONFIG = {
  chainId: BASE_SEPOLIA.chainId,
  name: BASE_SEPOLIA.name,
  nativeCurrency: BASE_SEPOLIA.nativeCurrency,
  rpcUrls: [BASE_SEPOLIA.rpcUrl],
  blockExplorers: [{ name: 'Basescan (Sepolia)', url: BASE_SEPOLIA.blockExplorer }],
} as const;

export function getExplorerUrl(address: string, type: 'address' | 'tx' = 'address'): string {
  return `${NETWORK_CONFIG.blockExplorers[0].url}/${type}/${address}`;
}

export function isValidContractAddress(address: string): boolean {
  const all = [...Object.values(CONTRACT_ADDRESSES), ...Object.values(ASSET_ADDRESSES)].map((a) => a.toLowerCase());
  return all.includes(address.toLowerCase());
}
