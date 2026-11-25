/**
 * Ethers helpers for the Base Sepolia tokenized-stock vault and B-20 test tokens.
 * Server-side (uses ethers); client components use @/lib/abis/client. Signing lives in getStockAgentSigner().
 */
import { ethers } from 'ethers';
import VaultJSON from '@/lib/abis/StockBasketVault.json';
import { B20_ABI } from '@/lib/abis/b20';
import { BASE_SEPOLIA, CASH_TOKEN, EXCHANGE_ADDRESS, STOCK_VAULT } from '@/config/base-sepolia';

export const STOCK_VAULT_ABI = VaultJSON.abi as ethers.InterfaceAbi;

export { B20_ABI };

export const MINT_ROLE = ethers.id('MINT_ROLE');

let readProvider: ethers.JsonRpcProvider | null = null;
export function getBaseSepoliaProvider() {
  readProvider ??= new ethers.JsonRpcProvider(
    process.env.BASE_SEPOLIA_RPC_URL || BASE_SEPOLIA.rpcUrl,
    { chainId: BASE_SEPOLIA.chainId, name: 'base-sepolia' },
    { staticNetwork: true },
  );
  return readProvider;
}

export function getStockVault(runner: ethers.ContractRunner = getBaseSepoliaProvider()) {
  return new ethers.Contract(STOCK_VAULT.address, STOCK_VAULT_ABI, runner);
}

export function getB20(address: string, runner: ethers.ContractRunner = getBaseSepoliaProvider()) {
  return new ethers.Contract(address, B20_ABI, runner);
}

export function getCashToken(runner?: ethers.ContractRunner) {
  return getB20(CASH_TOKEN.address, runner);
}

/**
 * Server-only: the agent wallet (price pusher + rebalancer, MINT_ROLE for the faucet).
 * It must NOT be the deployer: the deployer owns the exchange and factory and admins every token, so it never
 * belongs in the web server's env. In production a missing or deployer-equal STOCK_AGENT_PRIVATE_KEY fails closed.
 * Local dev may fall back to DEPLOYER_PRIVATE_KEY. Create the agent key with `node scripts/setup-agent-key.mjs`.
 */
export function getStockAgentSigner() {
  if (typeof window !== 'undefined') throw new Error('getStockAgentSigner is server-only');
  const agentKey = process.env.STOCK_AGENT_PRIVATE_KEY;
  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (process.env.NODE_ENV === 'production') {
    if (!agentKey) throw new Error('STOCK_AGENT_PRIVATE_KEY is not set (the deployer key is not used in production)');
    if (deployerKey && agentKey.toLowerCase() === deployerKey.toLowerCase()) {
      throw new Error('STOCK_AGENT_PRIVATE_KEY must differ from DEPLOYER_PRIVATE_KEY; remove the deployer key from this environment');
    }
  }
  const key = agentKey || deployerKey;
  if (!key) throw new Error('Set STOCK_AGENT_PRIVATE_KEY in .env.local (run scripts/setup-agent-key.mjs)');
  return new ethers.Wallet(key, getBaseSepoliaProvider());
}

/** USD (8-decimal, Chainlink convention) from a float NAV. */
export const toPrice8 = (usd: number) => ethers.parseUnits(usd.toFixed(8), 8);

// ---------------------------------------------------------------- shared StockExchange (price feed + issuer)

export const STOCK_EXCHANGE_ABI = [
  'function cashToken() view returns (address)',
  'function isListed(address token) view returns (bool)',
  'function price(address token) view returns (uint256)',
  'function priceUpdatedAt(address token) view returns (uint256)',
  'function maxPriceAge() view returns (uint256)',
  'function getListedTokens() view returns (address[])',
  'function setPrices(address[] tokens, uint256[] prices)',
] as const;

export function getStockExchange(runner: ethers.ContractRunner = getBaseSepoliaProvider()) {
  return new ethers.Contract(EXCHANGE_ADDRESS, STOCK_EXCHANGE_ABI, runner);
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
  const provider = getBaseSepoliaProvider();
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
export const exchangeIface = new ethers.Interface(STOCK_EXCHANGE_ABI);
