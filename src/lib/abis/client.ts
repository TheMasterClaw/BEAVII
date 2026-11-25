/**
 * viem-typed ABIs for client components. Keep this file free of ethers imports so it stays out of the browser bundle.
 */
import { parseAbi, type Abi, type AbiError } from 'viem';
import VaultJSON from '@/lib/abis/StockBasketVault.json';
import FactoryJSON from '@/lib/abis/ETFFactory.json';
import ExchangeJSON from '@/lib/abis/StockExchange.json';
import { B20_ABI } from '@/lib/abis/b20';

/**
 * Reverts bubble up across contracts: the factory reverts with the cloned vault's errors (BadWeights...),
 * and the vault with the exchange's (StalePrice...). Merge those custom errors in so viem can decode them
 * into names that txErrorMessage() maps to friendly text.
 */
function withErrorsFrom(abi: Abi, ...others: Abi[]): Abi {
  const key = (e: AbiError) => `${e.name}(${e.inputs.map((i) => i.type).join(',')})`;
  const seen = new Set(abi.filter((x): x is AbiError => x.type === 'error').map(key));
  const extra = others
    .flat()
    .filter((x): x is AbiError => x.type === 'error')
    .filter((e) => !seen.has(key(e)) && seen.add(key(e)));
  return [...abi, ...extra];
}

const vault = VaultJSON.abi as Abi;
const factory = FactoryJSON.abi as Abi;
const exchange = ExchangeJSON.abi as Abi;

export const vaultAbi = withErrorsFrom(vault, exchange);
export const factoryAbi = withErrorsFrom(factory, vault, exchange);
export const b20Abi = parseAbi(B20_ABI);
