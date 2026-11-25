/**
 * User-created ETFs: ETFFactory + cloned StockBasketVault, priced by the shared PriceOracle.
 * Safe on client and server. Reads go through getReadProvider(); writes take a signer.
 * Everything here is read from the chain: there is no mock or cached sample data.
 */
import { ethers } from 'ethers';
import FactoryJSON from '@/lib/abis/ETFFactory.json';
import { CASH_TOKEN, DEPLOYMENT, FACTORY_ADDRESS, findStock } from '@/config/network';
import { STOCK_VAULT_ABI, getReadProvider } from '@/lib/stock-vault';

export const ETF_FACTORY_ABI = FactoryJSON.abi as ethers.InterfaceAbi;
export const ETF_FACTORY_ADDRESS = FACTORY_ADDRESS;
export const FACTORY_DEPLOYED = Boolean(ETF_FACTORY_ADDRESS);

/** Limits enforced by the contracts (StockBasketVault / ETFFactory constants). */
export const FEE_LIMITS = {
  managementBps: 500,
  entryBps: 100,
  exitBps: 100,
  timelockDays: 3,
  basketTimelockHours: 24,
  rebalanceIntervalHours: 12,
  maxAssets: 20,
} as const;

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

export interface PendingBasket {
  tokens: string[];
  symbols: string[];
  weightsBps: number[];
  eta: number;
}

export interface EtfDetail extends EtfSummary {
  paused: boolean;
  lastRebalance: number;
  nextRebalanceAt: number;
  cashUsd: number;
  pendingFees: EtfFees | null;
  pendingFeesEta: number;
  pendingBasket: PendingBasket | null;
  accruedFeeShares: number;
  maxSlippageBps: number;
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

export function getEtfFactory(runner: ethers.ContractRunner = getReadProvider()) {
  return new ethers.Contract(ETF_FACTORY_ADDRESS, ETF_FACTORY_ABI, runner);
}

export function getEtfVault(address: string, runner: ethers.ContractRunner = getReadProvider()) {
  return new ethers.Contract(address, STOCK_VAULT_ABI, runner);
}

const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const MULTICALL3_ABI = ['function aggregate3((address target, bool allowFailure, bytes callData)[] calls) view returns ((bool success, bytes returnData)[])'];
const vaultIface = new ethers.Interface(STOCK_VAULT_ABI);
const factoryIface = new ethers.Interface(ETF_FACTORY_ABI);

/** Batch view calls into a single Multicall3 eth_call (fails if any call reverts). */
async function batch(calls: { target: string; iface: ethers.Interface; fn: string; args?: unknown[] }[]): Promise<any[]> {
  const mc = new ethers.Contract(MULTICALL3, MULTICALL3_ABI, getReadProvider());
  const res: { success: boolean; returnData: string }[] = await mc.aggregate3(
    calls.map((c) => ({ target: c.target, allowFailure: false, callData: c.iface.encodeFunctionData(c.fn, c.args ?? []) })),
  );
  return res.map((r, i) => {
    const decoded = calls[i].iface.decodeFunctionResult(calls[i].fn, r.returnData);
    return decoded.length === 1 ? decoded[0] : decoded;
  });
}

const vaultCalls = (address: string, calls: [fn: string, args?: unknown[]][]) =>
  batch(calls.map(([fn, args]) => ({ target: address, iface: vaultIface, fn, args })));

const n18 = (x: bigint) => Number(ethers.formatEther(x));
const toFees = (f: { managementFeeBps: bigint; entryFeeBps: bigint; exitFeeBps: bigint }): EtfFees => ({
  managementFeeBps: Number(f.managementFeeBps),
  entryFeeBps: Number(f.entryFeeBps),
  exitFeeBps: Number(f.exitFeeBps),
});
const displaySymbol = (token: string) => findStock(token)?.testSymbol ?? `${token.slice(0, 6)}…`;

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

type RawHolding = { token: string; targetWeight: bigint; balance: bigint; price: bigint; priceUpdatedAt: bigint; valueUsd: bigint; decimals: bigint };

function toHoldings(raw: RawHolding[], totalUsd: number): EtfHolding[] {
  const now = Math.floor(Date.now() / 1000);
  return raw
    .filter((h) => h.targetWeight > BigInt(0) || h.balance > BigInt(0))
    .map((h) => {
      const s = findStock(h.token);
      const value = n18(h.valueUsd);
      return {
        token: h.token,
        symbol: displaySymbol(h.token),
        name: s?.name ?? 'Unknown stock',
        iconUrl: s?.iconUrl,
        targetWeightBps: Number(h.targetWeight),
        actualWeightBps: totalUsd > 0 ? Math.round((value / totalUsd) * 10_000) : 0,
        balance: ethers.formatUnits(h.balance, Number(h.decimals)),
        priceUsd: h.price > BigInt(0) ? Number(ethers.formatUnits(h.price, 8)) : null,
        priceAgeSec: h.priceUpdatedAt > BigInt(0) ? now - Number(h.priceUpdatedAt) : null,
        valueUsd: value,
      };
    });
}

export async function readEtfHoldings(address: string, totalValueUsd: number): Promise<EtfHolding[]> {
  const [raw] = await vaultCalls(address, [['getHoldings']]);
  return toHoldings(raw, totalValueUsd);
}

export async function readEtfDetail(address: string, account?: string | null): Promise<EtfDetail> {
  const [summary, [paused, lastRebalance, interval, cashBalance, pending, eta, pendingBasket, accrued, holdings, shares], [slippage]] =
    await Promise.all([
      readEtfSummary(address),
      vaultCalls(address, [
        ['paused'],
        ['lastRebalanceTime'],
        ['MIN_REBALANCE_INTERVAL'],
        ['cashBalance'],
        ['pendingFees'],
        ['pendingFeesEta'],
        ['getPendingBasket'],
        ['previewAccruedFeeShares'],
        ['getHoldings'],
        ['balanceOf', [account ?? ethers.ZeroAddress]],
      ]),
      batch([{ target: ETF_FACTORY_ADDRESS, iface: factoryIface, fn: 'maxSlippageBps' }]),
    ]);

  let acct: EtfDetail['account'] = null;
  if (account) {
    const cash: bigint = CASH_TOKEN.address
      ? await new ethers.Contract(CASH_TOKEN.address, ['function balanceOf(address) view returns (uint256)'], getReadProvider()).balanceOf(account)
      : BigInt(0);
    const sharesN = n18(shares);
    const lower = account.toLowerCase();
    acct = {
      address: account,
      shares: sharesN,
      valueUsd: sharesN * summary.navPerShare,
      cash: Number(ethers.formatUnits(cash, CASH_TOKEN.decimals)),
      isManager: summary.manager.toLowerCase() === lower,
      feeRecipientValueUsd: summary.feeRecipient.toLowerCase() === lower ? sharesN * summary.navPerShare : 0,
    };
  }

  const [pTokens, pWeights, pEta] = pendingBasket as [string[], bigint[], bigint];
  const last = Number(lastRebalance);
  return {
    ...summary,
    paused,
    lastRebalance: last,
    nextRebalanceAt: last === 0 ? 0 : last + Number(interval),
    cashUsd: Number(ethers.formatUnits(cashBalance, CASH_TOKEN.decimals)),
    pendingFees: eta > BigInt(0) ? toFees(pending) : null,
    pendingFeesEta: Number(eta),
    pendingBasket:
      pEta > BigInt(0)
        ? { tokens: [...pTokens], symbols: pTokens.map(displaySymbol), weightsBps: pWeights.map(Number), eta: Number(pEta) }
        : null,
    accruedFeeShares: n18(accrued),
    maxSlippageBps: Number(slippage),
    holdings: toHoldings(holdings, summary.totalValueUsd),
    account: acct,
  };
}

async function allEtfAddresses(manager?: string | null): Promise<string[]> {
  if (!FACTORY_DEPLOYED) return [];
  const f = getEtfFactory();
  const addrs: string[] = manager ? await f.etfsOf(manager) : await f.allETFs();
  return [...addrs].reverse(); // newest first
}

/** Run `fn` over `items` in sequential chunks of `size` (the public RPC allows ~25 req/s). */
async function chunked<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>, label: string): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const res = await Promise.allSettled(items.slice(i, i + size).map(fn));
    res.forEach((r, j) => {
      if (r.status === 'fulfilled') out.push(r.value);
      else console.error(`${label}: failed for ${String(items[i + j])}`, r.reason);
    });
  }
  return out;
}

export async function listEtfs(manager?: string | null): Promise<EtfSummary[]> {
  return chunked(await allEtfAddresses(manager), 10, readEtfSummary, 'listEtfs');
}

export async function isFactoryEtf(address: string): Promise<boolean> {
  if (!FACTORY_DEPLOYED || !ethers.isAddress(address)) return false;
  return getEtfFactory().isVault(address);
}

// ---------------------------------------------------------------- portfolio (positions across every ETF)

export interface EtfPosition {
  etf: EtfSummary;
  shares: number;
  valueUsd: number;
  isManager: boolean;
}

/** Every ETF where `account` holds shares, valued at the current NAV. */
export async function listPositions(account: string): Promise<EtfPosition[]> {
  const addrs = await allEtfAddresses();
  if (!addrs.length) return [];
  const balances: bigint[] = [];
  for (let i = 0; i < addrs.length; i += 200) {
    const chunk = addrs.slice(i, i + 200);
    balances.push(...(await batch(chunk.map((a) => ({ target: a, iface: vaultIface, fn: 'balanceOf', args: [account] })))));
  }
  const held = addrs.filter((_, i) => balances[i] > BigInt(0));
  const summaries = await chunked(held, 10, readEtfSummary, 'listPositions');
  const lower = account.toLowerCase();
  return summaries
    .map((etf) => {
      const shares = n18(balances[addrs.indexOf(etf.address)]);
      return { etf, shares, valueUsd: shares * etf.navPerShare, isManager: etf.manager.toLowerCase() === lower };
    })
    .sort((x, y) => y.valueUsd - x.valueUsd);
}

// ---------------------------------------------------------------- analytics (aggregates across every ETF)

export interface StockExposure {
  token: string;
  symbol: string;
  name: string;
  iconUrl?: string;
  valueUsd: number;
  etfCount: number;
}

export interface ProtocolAnalytics {
  etfs: EtfSummary[];
  totalValueUsd: number;
  managerFeesUsd: number;
  protocolFeesUsd: number;
  exposure: StockExposure[];
  generatedAt: string;
}

/** Live totals across every ETF: AUM, fees paid, and combined stock exposure. */
export async function readProtocolAnalytics(): Promise<ProtocolAnalytics> {
  const etfs = await listEtfs();
  const holdingsPerEtf = await chunked(etfs, 10, (e) => readEtfHoldings(e.address, e.totalValueUsd), 'analytics holdings');
  const byToken = new Map<string, StockExposure>();
  for (const holdings of holdingsPerEtf) {
    for (const h of holdings) {
      if (h.valueUsd <= 0) continue;
      const key = h.token.toLowerCase();
      const row = byToken.get(key) ?? { token: h.token, symbol: h.symbol, name: h.name, iconUrl: h.iconUrl, valueUsd: 0, etfCount: 0 };
      row.valueUsd += h.valueUsd;
      row.etfCount += 1;
      byToken.set(key, row);
    }
  }
  return {
    etfs,
    totalValueUsd: etfs.reduce((a, e) => a + e.totalValueUsd, 0),
    managerFeesUsd: etfs.reduce((a, e) => a + e.managerFeesUsd, 0),
    protocolFeesUsd: etfs.reduce((a, e) => a + e.protocolFeesUsd, 0),
    exposure: [...byToken.values()].sort((x, y) => y.valueUsd - x.valueUsd),
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------- activity (onchain event history)

export interface EtfActivity {
  kind: 'deposit' | 'redeem' | 'created';
  etf: string;
  etfSymbol: string;
  txHash: string;
  blockNumber: number;
  timestamp: number | null;
  /** deposit: USD value added; redeem: amount out (cash units, or summed token units for in-kind) */
  valueUsd: number | null;
  shares: number | null;
  inKind: boolean;
}

/**
 * An account's deposits, redemptions and launches across every ETF, read from event logs between the
 * factory's deployment block and now. Logs are fetched in LOGS_BLOCK_RANGE chunks (default 10,000) so the
 * query stays within RPC provider limits.
 */
export async function readActivity(account: string, limit = 100): Promise<EtfActivity[]> {
  if (!FACTORY_DEPLOYED) return [];
  const provider = getReadProvider();
  const fromBlock = Number((DEPLOYMENT.factory as { deployBlock?: number } | undefined)?.deployBlock ?? 0);
  const latest = await provider.getBlockNumber();
  const range = Math.max(1, Number(process.env.LOGS_BLOCK_RANGE ?? 10_000));
  const vaults = await allEtfAddresses();
  const symbolOf = new Map<string, string>();
  const userTopic = ethers.zeroPadValue(account, 32);
  const deposited = vaultIface.getEvent('Deposited')!.topicHash;
  const withdrawn = vaultIface.getEvent('Withdrawn')!.topicHash;
  const created = factoryIface.getEvent('ETFCreated')!.topicHash;

  const logs: ethers.Log[] = [];
  for (let start = Math.max(fromBlock, 0); start <= latest; start += range) {
    const end = Math.min(start + range - 1, latest);
    const [userLogs, createdLogs] = await Promise.all([
      vaults.length
        ? provider.getLogs({ address: vaults, topics: [[deposited, withdrawn], userTopic], fromBlock: start, toBlock: end })
        : Promise.resolve([]),
      provider.getLogs({ address: ETF_FACTORY_ADDRESS, topics: [created, null, userTopic], fromBlock: start, toBlock: end }),
    ]);
    logs.push(...userLogs, ...createdLogs);
  }

  const rows: EtfActivity[] = [];
  for (const log of logs) {
    if (log.address.toLowerCase() === ETF_FACTORY_ADDRESS.toLowerCase()) {
      const ev = factoryIface.parseLog(log)!;
      symbolOf.set(String(ev.args.vault).toLowerCase(), ev.args.symbol);
      rows.push({ kind: 'created', etf: ev.args.vault, etfSymbol: ev.args.symbol, txHash: log.transactionHash, blockNumber: log.blockNumber, timestamp: null, valueUsd: null, shares: null, inKind: false });
      continue;
    }
    const ev = vaultIface.parseLog(log)!;
    if (ev.name === 'Deposited') {
      rows.push({ kind: 'deposit', etf: log.address, etfSymbol: '', txHash: log.transactionHash, blockNumber: log.blockNumber, timestamp: null, valueUsd: n18(ev.args.valueUsd), shares: n18(ev.args.shares), inKind: ev.args.token.toLowerCase() !== CASH_TOKEN.address.toLowerCase() });
    } else {
      const inKind = ev.args.tokenOut === ethers.ZeroAddress;
      rows.push({ kind: 'redeem', etf: log.address, etfSymbol: '', txHash: log.transactionHash, blockNumber: log.blockNumber, timestamp: null, valueUsd: inKind ? null : Number(ethers.formatUnits(ev.args.amountOut, CASH_TOKEN.decimals)), shares: n18(ev.args.shares), inKind });
    }
  }
  rows.sort((x, y) => y.blockNumber - x.blockNumber);
  const top = rows.slice(0, limit);

  // ETF symbols and block timestamps for the rows we return
  const missing = [...new Set(top.filter((r) => !symbolOf.has(r.etf.toLowerCase())).map((r) => r.etf))];
  if (missing.length) {
    const syms = await batch(missing.map((a) => ({ target: a, iface: vaultIface, fn: 'symbol' })));
    missing.forEach((a, i) => symbolOf.set(a.toLowerCase(), syms[i]));
  }
  const blocks = [...new Set(top.map((r) => r.blockNumber))];
  const times = new Map<number, number>();
  await chunked(blocks, 10, async (n) => times.set(n, (await provider.getBlock(n))?.timestamp ?? 0), 'activity blocks');
  for (const r of top) {
    r.etfSymbol = symbolOf.get(r.etf.toLowerCase()) ?? r.etfSymbol;
    r.timestamp = times.get(r.blockNumber) ?? null;
  }
  return top;
}

/** What a manager earns per year at a given AUM (management fee only, after the protocol cut). */
export function estimateManagerYearlyUsd(aumUsd: number, fees: EtfFees, protocolFeeBps: number) {
  return aumUsd * (fees.managementFeeBps / 10_000) * (1 - protocolFeeBps / 10_000);
}

export const bpsToPct = (bps: number, digits = 2) => `${(bps / 100).toFixed(digits)}%`;
