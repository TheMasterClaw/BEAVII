/**
 * Ethers helpers for the tokenized-stock ETFs, the shared PriceOracle and the stock tokens.
 * Safe to import on client and server; server-only signing lives in getStockAgentSigner().
 */
import { ethers } from 'ethers';
import VaultJSON from '@/lib/abis/StockBasketVault.json';
import { CASH_TOKEN, IS_MAINNET, NETWORK, ORACLE_ADDRESS, STOCK_VAULT, serverRpcUrl } from '@/config/network';

export const STOCK_VAULT_ABI = VaultJSON.abi as ethers.InterfaceAbi;

export const B20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function mint(address to, uint256 amount)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function multiplier() view returns (uint256)',
] as const;

export const MINT_ROLE = ethers.id('MINT_ROLE');

let readProvider: ethers.JsonRpcProvider | null = null;
/** Read-only provider: the server RPC (may carry an API key) on the server, the public RPC in the browser. */
export function getReadProvider() {
  readProvider ??= new ethers.JsonRpcProvider(
    typeof window === 'undefined' ? serverRpcUrl() : NETWORK.rpcUrl,
    { chainId: NETWORK.chainId, name: NETWORK.key },
    { staticNetwork: true },
  );
  return readProvider;
}

export function getStockVault(runner: ethers.ContractRunner = getReadProvider()) {
  return new ethers.Contract(STOCK_VAULT.address, STOCK_VAULT_ABI, runner);
}

export function getB20(address: string, runner: ethers.ContractRunner = getReadProvider()) {
  return new ethers.Contract(address, B20_ABI, runner);
}

export function getCashToken(runner?: ethers.ContractRunner) {
  return getB20(CASH_TOKEN.address, runner);
}

/**
 * Server-only: the protocol agent (price pusher / rebalancer). On testnet it also holds MINT_ROLE on the test
 * tokens for the faucet and may fall back to the deployer key. On mainnet it must be its own key
 * (STOCK_AGENT_PRIVATE_KEY), never the deployer or owner: it can only push bounded prices and rebalance.
 */
export function getStockAgentSigner() {
  if (typeof window !== 'undefined') throw new Error('getStockAgentSigner is server-only');
  const key = IS_MAINNET ? process.env.STOCK_AGENT_PRIVATE_KEY : process.env.STOCK_AGENT_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
  if (!key) {
    throw new Error(IS_MAINNET ? 'Set STOCK_AGENT_PRIVATE_KEY (a dedicated agent key)' : 'Set STOCK_AGENT_PRIVATE_KEY or DEPLOYER_PRIVATE_KEY');
  }
  const wallet = new ethers.Wallet(key, getReadProvider());
  if (IS_MAINNET && process.env.DEPLOYER_PRIVATE_KEY && wallet.privateKey === new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY).privateKey) {
    throw new Error('STOCK_AGENT_PRIVATE_KEY must not be the deployer key on mainnet');
  }
  return wallet;
}

/** USD (8-decimal, Chainlink convention) from a float NAV. */
export const toPrice8 = (usd: number) => ethers.parseUnits(usd.toFixed(8), 8);

// ---------------------------------------------------------------- shared PriceOracle (NAV feed + asset registry)

export const PRICE_ORACLE_ABI = [
  'function cashToken() view returns (address)',
  'function isListed(address token) view returns (bool)',
  'function price(address token) view returns (uint256)',
  'function priceUpdatedAt(address token) view returns (uint256)',
  'function maxPriceAge() view returns (uint256)',
  'function maxAgeOf(address token) view returns (uint256)',
  'function maxDeviationBps() view returns (uint256)',
  'function feeds(address token) view returns (address aggregator, uint32 heartbeat)',
  'function getListedTokens() view returns (address[])',
  'function setPrices(address[] tokens, uint256[] prices)',
] as const;

export function getPriceOracle(runner: ethers.ContractRunner = getReadProvider()) {
  return new ethers.Contract(ORACLE_ADDRESS, PRICE_ORACLE_ABI, runner);
}

// ---------------------------------------------------------------- Multicall3 (same address on every chain)
export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const multicallIface = new ethers.Interface([
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) view returns ((bool success, bytes returnData)[])',
]);

/**
 * Batched eth_call. Each call returns its decoded first output, or null if it reverted.
 * Split into chunks so a 415-token read stays well under RPC limits.
 */
export async function multicall<T = unknown>(
  calls: { target: string; iface: ethers.Interface; fn: string; args?: unknown[] }[],
  chunkSize = 400,
): Promise<(T | null)[]> {
  const provider = getReadProvider();
  const out: (T | null)[] = [];
  for (let i = 0; i < calls.length; i += chunkSize) {
    const chunk = calls.slice(i, i + chunkSize);
    const data = multicallIface.encodeFunctionData('aggregate3', [
      chunk.map((c) => ({ target: c.target, allowFailure: true, callData: c.iface.encodeFunctionData(c.fn, c.args ?? []) })),
    ]);
    const raw = await provider.call({ to: MULTICALL3, data });
    const [results] = multicallIface.decodeFunctionResult('aggregate3', raw);
    results.forEach((r: { success: boolean; returnData: string }, j: number) => {
      if (!r.success || r.returnData === '0x') return out.push(null);
      try {
        out.push(chunk[j].iface.decodeFunctionResult(chunk[j].fn, r.returnData)[0] as T);
      } catch {
        out.push(null);
      }
    });
  }
  return out;
}

export const b20Iface = new ethers.Interface(B20_ABI);
export const oracleIface = new ethers.Interface(PRICE_ORACLE_ABI);
