/**
 * User-created ETFs: ETFFactory + cloned StockBasketVault + shared StockExchange on Base Sepolia.
 * Safe on client and server. Reads go through getBaseSepoliaProvider(); writes take a signer.
 */
import { ethers } from 'ethers';
import FactoryJSON from '@/lib/abis/ETFFactory.json';
import ExchangeJSON from '@/lib/abis/StockExchange.json';
import { DEPLOYMENT, findStock } from '@/config/base-sepolia';
import { STOCK_VAULT_ABI, getBaseSepoliaProvider } from '@/lib/stock-vault';

export const ETF_FACTORY_ABI = FactoryJSON.abi as ethers.InterfaceAbi;
export const STOCK_EXCHANGE_ABI = ExchangeJSON.abi as ethers.InterfaceAbi;

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

export function getEtfFactory(runner: ethers.ContractRunner = getBaseSepoliaProvider()) {
  return new ethers.Contract(ETF_FACTORY_ADDRESS, ETF_FACTORY_ABI, runner);
}

export function getEtfVault(address: string, runner: ethers.ContractRunner = getBaseSepoliaProvider()) {
  return new ethers.Contract(address, STOCK_VAULT_ABI, runner);
}

export function getStockExchange(runner: ethers.ContractRunner = getBaseSepoliaProvider()) {
  return new ethers.Contract(STOCK_EXCHANGE_ADDRESS, STOCK_EXCHANGE_ABI, runner);
}

const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const MULTICALL3_ABI = ['function aggregate3((address target, bool allowFailure, bytes callData)[] calls) view returns ((bool success, bytes returnData)[])'];
const vaultIface = new ethers.Interface(STOCK_VAULT_ABI);

/** Batch view calls on one vault into a single Multicall3 eth_call (fails if any call reverts). */
async function vaultCalls(address: string, calls: [fn: string, args?: unknown[]][]): Promise<any[]> {
  const mc = new ethers.Contract(MULTICALL3, MULTICALL3_ABI, getBaseSepoliaProvider());
  const res: { success: boolean; returnData: string }[] = await mc.aggregate3(
    calls.map(([fn, args]) => ({ target: address, allowFailure: false, callData: vaultIface.encodeFunctionData(fn, args ?? []) })),
  );
  return res.map((r, i) => {
    const decoded = vaultIface.decodeFunctionResult(calls[i][0], r.returnData);
    return decoded.length === 1 ? decoded[0] : decoded;
  });
}

const n18 = (x: bigint) => Number(ethers.formatEther(x));
const toFees = (f: { managementFeeBps: bigint; entryFeeBps: bigint; exitFeeBps: bigint }): EtfFees => ({
  managementFeeBps: Number(f.managementFeeBps),
  entryFeeBps: Number(f.entryFeeBps),
  exitFeeBps: Number(f.exitFeeBps),
});

export async function readEtfSummary(address: string): Promise<EtfSummary> {
  const [name, symbol, description, manager, feeRecipient, fees, protocolFeeBps, tv, nav, supply, mUsd, pUsd, createdAt, assetCount] =
    await vaultCalls(address, [
      ['name'],
      ['symbol'],
      ['description'],
      ['owner'],
      ['feeRecipient'],
      ['fees'],
      ['protocolFeeBps'],
      ['getTotalValue'],
      ['getNetAssetValue'],
      ['totalSupply'],
      ['managerFeesUsd'],
      ['protocolFeesUsd'],
      ['createdAt'],
      ['assetCount'],
    ]);
  return {
    address,
    name,
    symbol,
    description,
    manager,
    feeRecipient,
    fees: toFees(fees),
    protocolFeeBps: Number(protocolFeeBps),
    totalValueUsd: n18(tv),
    navPerShare: n18(nav),
    totalShares: n18(supply),
    managerFeesUsd: n18(mUsd),
    protocolFeesUsd: n18(pUsd),
    createdAt: Number(createdAt),
    assetCount: Number(assetCount),
  };
}

export async function readEtfDetail(address: string, account?: string | null): Promise<EtfDetail> {
  const [summary, [paused, lastRebalance, pending, eta, accrued, holdings, shares]] = await Promise.all([
    readEtfSummary(address),
    vaultCalls(address, [
      ['paused'],
      ['lastRebalanceTime'],
      ['pendingFees'],
      ['pendingFeesEta'],
      ['previewAccruedFeeShares'],
      ['getHoldings'],
      ['balanceOf', [account ?? ethers.ZeroAddress]],
    ]),
  ]);
  const now = Math.floor(Date.now() / 1000);
  const total = summary.totalValueUsd;
  const rows: EtfHolding[] = holdings
    .filter((h: { targetWeight: bigint; balance: bigint }) => h.targetWeight > BigInt(0) || h.balance > BigInt(0))
    .map((h: { token: string; targetWeight: bigint; balance: bigint; price: bigint; priceUpdatedAt: bigint; valueUsd: bigint; decimals: bigint }) => {
      const s = findStock(h.token);
      const value = n18(h.valueUsd);
      return {
        token: h.token,
        symbol: s?.testSymbol ?? `${h.token.slice(0, 6)}…`,
        name: s?.name ?? 'Unknown stock',
        iconUrl: s?.iconUrl,
        targetWeightBps: Number(h.targetWeight),
        actualWeightBps: total > 0 ? Math.round((value / total) * 10_000) : 0,
        balance: ethers.formatUnits(h.balance, Number(h.decimals)),
        priceUsd: h.price > BigInt(0) ? Number(ethers.formatUnits(h.price, 8)) : null,
        priceAgeSec: h.priceUpdatedAt > BigInt(0) ? now - Number(h.priceUpdatedAt) : null,
        valueUsd: value,
      };
    });

  let acct: EtfDetail['account'] = null;
  if (account) {
    const cashAddr = DEPLOYMENT.cashToken?.address;
    const cash: bigint = cashAddr
      ? await new ethers.Contract(cashAddr, ['function balanceOf(address) view returns (uint256)'], getBaseSepoliaProvider()).balanceOf(account)
      : BigInt(0);
    const sharesN = n18(shares);
    const lower = account.toLowerCase();
    acct = {
      address: account,
      shares: sharesN,
      valueUsd: sharesN * summary.navPerShare,
      cash: Number(ethers.formatUnits(cash, DEPLOYMENT.cashToken?.decimals ?? 6)),
      isManager: summary.manager.toLowerCase() === lower,
      feeRecipientValueUsd: summary.feeRecipient.toLowerCase() === lower ? sharesN * summary.navPerShare : 0,
    };
  }

  return {
    ...summary,
    paused,
    lastRebalance: Number(lastRebalance),
    pendingFees: eta > BigInt(0) ? toFees(pending) : null,
    pendingFeesEta: Number(eta),
    accruedFeeShares: n18(accrued),
    holdings: rows,
    account: acct,
  };
}

export async function listEtfs(manager?: string | null): Promise<EtfSummary[]> {
  if (!FACTORY_DEPLOYED) return [];
  // Current factory first, then retired ones; each newest first.
  const list: string[] = [];
  for (const addr of [ETF_FACTORY_ADDRESS, ...LEGACY_FACTORY_ADDRESSES]) {
    const f = new ethers.Contract(addr, ETF_FACTORY_ABI, getBaseSepoliaProvider());
    const addrs: string[] = manager ? await f.etfsOf(manager) : await f.allETFs();
    list.push(...[...addrs].reverse());
  }
  const out: EtfSummary[] = [];
  // Sequential chunks: each summary is one Multicall3 eth_call, and the public RPC allows ~25 req/s.
  for (let i = 0; i < list.length; i += 10) {
    const chunk = await Promise.allSettled(list.slice(i, i + 10).map((a) => readEtfSummary(a)));
    chunk.forEach((r, j) => {
      if (r.status === 'fulfilled') out.push(r.value);
      else console.error(`listEtfs: failed to read ${list[i + j]}`, r.reason);
    });
  }
  return out;
}

export async function isFactoryEtf(address: string): Promise<boolean> {
  if (!FACTORY_DEPLOYED || !ethers.isAddress(address)) return false;
  for (const f of [ETF_FACTORY_ADDRESS, ...LEGACY_FACTORY_ADDRESSES]) {
    if (await new ethers.Contract(f, ETF_FACTORY_ABI, getBaseSepoliaProvider()).isVault(address)) return true;
  }
  return false;
}

/** What a manager earns per year at a given AUM (management fee only, after the protocol cut). */
export function estimateManagerYearlyUsd(aumUsd: number, fees: EtfFees, protocolFeeBps: number) {
  return aumUsd * (fees.managementFeeBps / 10_000) * (1 - protocolFeeBps / 10_000);
}

export const bpsToPct = (bps: number, digits = 2) => `${(bps / 100).toFixed(digits)}%`;
