import { ethers } from 'ethers';

// Contract addresses - Base Sepolia (see src/config/deployments/base-sepolia.json)
import { BASE_SEPOLIA, CASH_TOKEN, STOCK_VAULT, STOCKS } from '@/config/base-sepolia';

export const CONTRACT_ADDRESSES = {
  usdc: CASH_TOKEN.address,
  etfVault: STOCK_VAULT.address,
};

export const BASE_TESTNET = {
  chainId: BASE_SEPOLIA.chainId,
  name: BASE_SEPOLIA.name,
  rpcUrl: BASE_SEPOLIA.rpcUrl,
  blockExplorer: BASE_SEPOLIA.blockExplorer,
};

// Simplified ABIs for our purposes
const ETFVaultABI = [
  // Read functions
  'function getTotalValue() view returns (uint256)',
  'function getNetAssetValue() view returns (uint256)',
  'function getActiveAssets() view returns (address[])',
  'function getHoldings() view returns (tuple(address token, uint256 targetWeight, uint256 balance, uint256 price, uint256 priceUpdatedAt, uint256 valueUsd, uint8 decimals)[])',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  
  // Write functions
  'function deposit(address token, uint256 amount) returns (uint256)',
  'function withdraw(uint256 shares, address tokenOut, uint256 minAmountOut) returns (uint256)',
  'function rebalance()',
  'function setWeights(address[] tokens, uint256[] weights)',
  'function setPrices(address[] tokens, uint256[] prices)',
  
  // Events
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event AssetAdded(address indexed token, uint256 weight)',
  'event Deposited(address indexed user, address indexed token, uint256 amount, uint256 valueUsd, uint256 shares)',
  'event Withdrawn(address indexed user, address indexed tokenOut, uint256 shares, uint256 amountOut)',
  'event Rebalanced(uint256 totalValueUsd)'
];

const TokenABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function mint(address to, uint256 amount)'
];

// Get provider for server-side operations
export function getServerProvider() {
  return new ethers.JsonRpcProvider(BASE_TESTNET.rpcUrl);
}

// Get signer from private key (for backend operations)
export function getServerSigner(privateKey: string) {
  const provider = getServerProvider();
  return new ethers.Wallet(privateKey, provider);
}

// Get contract instances
export function getContracts(signerOrProvider: ethers.Signer | ethers.Provider) {
  return {
    etfVault: new ethers.Contract(CONTRACT_ADDRESSES.etfVault, ETFVaultABI, signerOrProvider),
    usdc: new ethers.Contract(CONTRACT_ADDRESSES.usdc, TokenABI, signerOrProvider),
    stocks: Object.fromEntries(STOCKS.map((s) => [s.testSymbol, new ethers.Contract(s.address, TokenABI, signerOrProvider)])),
  };
}

// Helper to format amounts from wei to human-readable
export function formatAmount(amount: bigint | string) {
  return ethers.formatEther(amount);
}

// Helper to convert amounts to wei
export function parseAmount(amount: string | number) {
  return ethers.parseEther(amount.toString());
}

// Get token name by address
export function getTokenName(address: string): string {
  const a = address.toLowerCase();
  if (a === CONTRACT_ADDRESSES.usdc.toLowerCase()) return CASH_TOKEN.symbol;
  return STOCKS.find((s) => s.address.toLowerCase() === a)?.testSymbol ?? 'Unknown';
}

// Get token logo URL by address
export function getTokenLogo(address: string): string {
  const a = address.toLowerCase();
  return STOCKS.find((s) => s.address.toLowerCase() === a)?.iconUrl ?? (a === CONTRACT_ADDRESSES.usdc.toLowerCase() ? '/flower.png' : '/snail.png');
}
