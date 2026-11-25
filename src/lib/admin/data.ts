/**
 * Server-only: everything the /admin page shows. Each probe is isolated, so one failing dependency
 * marks its own check as down instead of breaking the page. Never returns secret values, only whether they are set.
 */
import { ethers } from 'ethers';
import { CASH_TOKEN, DEPLOYMENT, EXCHANGE_ADDRESS, FACTORY_ADDRESS, HAS_EXCHANGE, STOCKS, STOCK_VAULT } from '@/config/base-sepolia';
import { MULTICALL3, b20Iface, exchangeIface, getBaseSepoliaProvider, getStockAgentSigner, multicall } from '@/lib/stock-vault';
import { listEtfs, readEtfSummary, type EtfSummary } from '@/lib/etf';
import { fetchTokenizedStocks } from '@/lib/tokenized-stocks';
import { agentStore, agentStoreBackend, type AgentRecord } from '@/lib/agent-accounts/store';

export type Status = 'ok' | 'warn' | 'down';
export type Check = { name: string; status: Status; detail: string; ms?: number };

export type AdminAgent = Omit<AgentRecord, 'keyHash'> & { active: boolean; ethBalance: number | null; cashBalance: number | null };
export type AdminUser = {
  address: string;
  etfsManaged: number;
  aumManagedUsd: number;
  feesEarnedUsd: number;
  agents: number;
  activeAgents: number;
  firstSeen: number; // ms
};
export type WeeklyPoint = { weekStart: number; count: number };

export type AdminSnapshot = {
  generatedAt: number;
  tookMs: number;
  health: Check[];
  config: { name: string; set: boolean; required: boolean; note?: string }[];
  runtime: Record<string, string>;
  analytics: {
    etfCount: number;
    totalAumUsd: number;
    managerFeesUsd: number;
    protocolFeesUsd: number;
    flagship: { name: string; symbol: string; aumUsd: number; navPerShare: number } | null;
    agentCount: number;
    activeAgents: number;
    revokedAgents: number;
    agentFundsUsd: number;
    uniqueUsers: number;
    listedStocks: number;
    cashSupply: number | null;
    treasury: { address: string; cash: number | null; eth: number | null } | null;
    signer: { address: string; eth: number | null } | null;
    etfsPerWeek: WeeklyPoint[];
    agentsPerWeek: WeeklyPoint[];
  };
  etfs: EtfSummary[];
  agents: AdminAgent[];
  users: AdminUser[];
  errors: string[];
};

const LOW_SIGNER_ETH = 0.01;
const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

async function timed<T>(fn: () => Promise<T>): Promise<{ value?: T; error?: string; ms: number }> {
  const t = performance.now();
  try {
    const value = await fn();
    return { value, ms: Math.round(performance.now() - t) };
  } catch (e) {
    return { error: msgOf(e), ms: Math.round(performance.now() - t) };
  }
}

const multicallIface = new ethers.Interface(['function getEthBalance(address) view returns (uint256)']);

/** ETH + tUSDC balances for many addresses in batched Multicall3 calls. */
async function balances(addresses: string[]) {
  if (!addresses.length) return { eth: [] as (number | null)[], cash: [] as (number | null)[] };
  const eth = await multicall<bigint>(addresses.map((a) => ({ target: MULTICALL3, iface: multicallIface, fn: 'getEthBalance', args: [a] })));
  const cash = CASH_TOKEN.address
    ? await multicall<bigint>(addresses.map((a) => ({ target: CASH_TOKEN.address, iface: b20Iface, fn: 'balanceOf', args: [a] })))
    : addresses.map(() => null);
  return {
    eth: eth.map((v) => (v === null ? null : Number(ethers.formatEther(v)))),
    cash: cash.map((v) => (v === null ? null : Number(ethers.formatUnits(v, CASH_TOKEN.decimals)))),
  };
}

const WEEK = 7 * 24 * 3600 * 1000;
function weekly(timestampsMs: number[], weeks = 12): WeeklyPoint[] {
  const now = Date.now();
  const start = now - weeks * WEEK;
  const out = Array.from({ length: weeks }, (_, i) => ({ weekStart: start + i * WEEK, count: 0 }));
  for (const t of timestampsMs) {
    const i = Math.floor((t - start) / WEEK);
    if (i >= 0 && i < weeks) out[i].count++;
  }
  return out;
}

export async function collectAdminSnapshot(): Promise<AdminSnapshot> {
  const t0 = performance.now();
  const provider = getBaseSepoliaProvider();
  const errors: string[] = [];
  const health: Check[] = [];

  // Independent probes in parallel. listEtfs is the slow one (sequential RPC chunks).
  const [rpc, store, etfsRes, signerRes, coinbase, prices, flagshipRes, cashSupplyRes] = await Promise.all([
    timed(async () => {
      const block = await provider.getBlock('latest');
      if (!block) throw new Error('no latest block');
      return block;
    }),
    timed(() => agentStore().all()),
    timed(() => listEtfs()),
    timed(async () => {
      const signer = getStockAgentSigner();
      return { address: signer.address, eth: Number(ethers.formatEther(await provider.getBalance(signer.address))) };
    }),
    timed(() => fetchTokenizedStocks(0)),
    timed(async () => {
      if (!HAS_EXCHANGE) return null;
      const listed = STOCKS.filter((s) => s.address);
      const [maxAge, updated] = await Promise.all([
        new ethers.Contract(EXCHANGE_ADDRESS, exchangeIface, provider).maxPriceAge() as Promise<bigint>,
        multicall<bigint>(listed.map((s) => ({ target: EXCHANGE_ADDRESS, iface: exchangeIface, fn: 'priceUpdatedAt', args: [s.address] }))),
      ]);
      const now = Math.floor(Date.now() / 1000);
      const ages = updated.filter((u): u is bigint => u !== null && u > BigInt(0)).map((u) => now - Number(u));
      return { maxAge: Number(maxAge), priced: ages.length, total: listed.length, stale: ages.filter((a) => a > Number(maxAge)).length, oldest: ages.length ? Math.max(...ages) : null, newest: ages.length ? Math.min(...ages) : null };
    }),
    timed(async () => (STOCK_VAULT.address ? readEtfSummary(STOCK_VAULT.address) : null)),
    timed(async () => {
      if (!CASH_TOKEN.address) return null;
      const [supply] = await multicall<bigint>([{ target: CASH_TOKEN.address, iface: b20Iface, fn: 'totalSupply' }]);
      return supply === null ? null : Number(ethers.formatUnits(supply, CASH_TOKEN.decimals));
    }),
  ]);

  // ---------------------------------------------------------------- health checks
  if (rpc.value) {
    const lag = Math.floor(Date.now() / 1000) - rpc.value.timestamp;
    health.push({
      name: 'Base Sepolia RPC',
      status: rpc.ms > 3000 || lag > 120 ? 'warn' : 'ok',
      detail: `block ${rpc.value.number.toLocaleString()} · head ${lag}s old`,
      ms: rpc.ms,
    });
  } else health.push({ name: 'Base Sepolia RPC', status: 'down', detail: rpc.error ?? 'unreachable', ms: rpc.ms });

  const backend = agentStoreBackend();
  health.push(
    store.value
      ? { name: 'Agent registry', status: backend === 'file' && process.env.NODE_ENV === 'production' ? 'warn' : 'ok', detail: `${backend} · ${store.value.length} records`, ms: store.ms }
      : { name: 'Agent registry', status: 'down', detail: `${backend}: ${store.error}`, ms: store.ms },
  );

  health.push(
    etfsRes.value
      ? { name: 'ITF factory', status: FACTORY_ADDRESS ? 'ok' : 'warn', detail: FACTORY_ADDRESS ? `${etfsRes.value.length} ITFs` : 'factory not deployed', ms: etfsRes.ms }
      : { name: 'ITF factory', status: 'down', detail: etfsRes.error ?? 'read failed', ms: etfsRes.ms },
  );

  if (signerRes.value) {
    const low = signerRes.value.eth < LOW_SIGNER_ETH;
    health.push({
      name: 'Agent signer gas',
      status: low ? 'warn' : 'ok',
      detail: `${signerRes.value.eth.toFixed(4)} ETH${low ? ` · below ${LOW_SIGNER_ETH}, top it up` : ''}`,
      ms: signerRes.ms,
    });
  } else health.push({ name: 'Agent signer gas', status: 'down', detail: signerRes.error ?? 'no signer', ms: signerRes.ms });

  if (prices.value) {
    const p = prices.value;
    health.push({
      name: 'Price feed freshness',
      status: p.priced === 0 || p.stale > p.priced / 2 ? 'down' : p.stale > 0 ? 'warn' : 'ok',
      detail: `${p.priced}/${p.total} priced · ${p.stale} stale (max age ${Math.round(p.maxAge / 60)} min) · oldest ${p.oldest === null ? 'n/a' : fmtAge(p.oldest)}`,
      ms: prices.ms,
    });
  } else if (prices.error) health.push({ name: 'Price feed freshness', status: 'down', detail: prices.error, ms: prices.ms });
  else health.push({ name: 'Price feed freshness', status: 'warn', detail: 'StockExchange not deployed' });

  health.push(
    coinbase.value
      ? { name: 'Coinbase tokenized-stocks API', status: coinbase.ms > 5000 ? 'warn' : 'ok', detail: `${coinbase.value.length} tokens`, ms: coinbase.ms }
      : { name: 'Coinbase tokenized-stocks API', status: 'down', detail: coinbase.error ?? 'failed', ms: coinbase.ms },
  );

  const isProd = process.env.NODE_ENV === 'production';
  if (isProd && process.env.DEPLOYER_PRIVATE_KEY) {
    health.push({ name: 'Key hygiene', status: 'warn', detail: 'DEPLOYER_PRIVATE_KEY is set in production; remove it from this environment' });
  }

  // ---------------------------------------------------------------- config (booleans only, never values)
  const has = (...k: string[]) => k.some((n) => Boolean(process.env[n]));
  const config = [
    { name: 'ADMIN_SECRET', set: true, required: true },
    { name: 'STOCK_AGENT_PRIVATE_KEY', set: has('STOCK_AGENT_PRIVATE_KEY'), required: isProd },
    { name: 'STOCK_AGENT_SECRET / CRON_SECRET', set: has('STOCK_AGENT_SECRET', 'CRON_SECRET'), required: true },
    { name: 'AGENT_WALLET_SEED', set: has('AGENT_WALLET_SEED'), required: true, note: 'losing it loses every agent wallet' },
    { name: 'UPSTASH_REDIS_REST_URL/TOKEN', set: has('UPSTASH_REDIS_REST_URL', 'KV_REST_API_URL') && has('UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_TOKEN'), required: Boolean(process.env.VERCEL) },
    { name: 'PROTOCOL_TREASURY_ADDRESS', set: has('PROTOCOL_TREASURY_ADDRESS'), required: false },
    { name: 'NEXT_PUBLIC_REOWN_PROJECT_ID', set: has('NEXT_PUBLIC_REOWN_PROJECT_ID'), required: true },
    { name: 'CMC_API_KEY', set: has('CMC_API_KEY'), required: false },
    { name: 'BASE_SEPOLIA_RPC_URL', set: has('BASE_SEPOLIA_RPC_URL'), required: false, note: 'public RPC is rate limited' },
    { name: 'AGENT_GAS_SPONSOR', set: process.env.AGENT_GAS_SPONSOR !== 'off', required: false, note: 'on unless "off"' },
  ];
  for (const c of config) if (c.required && !c.set) health.push({ name: `Config: ${c.name}`, status: 'down', detail: 'required but not set' });

  const mem = process.memoryUsage();
  const runtime: Record<string, string> = {
    Environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown',
    Region: process.env.VERCEL_REGION ?? 'local',
    Commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? 'local').slice(0, 7),
    Node: process.version,
    'Instance uptime': fmtAge(Math.floor(process.uptime())),
    'Memory (RSS / heap)': `${Math.round(mem.rss / 1e6)} / ${Math.round(mem.heapUsed / 1e6)} MB`,
    'Chain ID': String(DEPLOYMENT.chainId),
    Deployed: DEPLOYMENT.deployedAt ? new Date(DEPLOYMENT.deployedAt).toISOString().slice(0, 10) : 'n/a',
  };

  // ---------------------------------------------------------------- analytics + users
  const etfs = etfsRes.value ?? [];
  const rawAgents = store.value ?? [];
  if (etfsRes.error) errors.push(`ITFs: ${etfsRes.error}`);
  if (store.error) errors.push(`Agents: ${store.error}`);

  const treasuryAddr = process.env.PROTOCOL_TREASURY_ADDRESS;
  const extra = [treasuryAddr].filter((a): a is string => Boolean(a && ethers.isAddress(a)));
  const bal = await timed(() => balances([...rawAgents.map((a) => a.address), ...extra]));
  if (bal.error) errors.push(`Balances: ${bal.error}`);
  const ethB = bal.value?.eth ?? [];
  const cashB = bal.value?.cash ?? [];

  const agents: AdminAgent[] = rawAgents.map((r, i) => {
    const { keyHash, ...rest } = r;
    return { ...rest, active: Boolean(keyHash) && !r.revokedAt, ethBalance: ethB[i] ?? null, cashBalance: cashB[i] ?? null };
  });

  const users = new Map<string, AdminUser>();
  const user = (addr: string, seen: number) => {
    const k = addr.toLowerCase();
    let u = users.get(k);
    if (!u) users.set(k, (u = { address: k, etfsManaged: 0, aumManagedUsd: 0, feesEarnedUsd: 0, agents: 0, activeAgents: 0, firstSeen: seen }));
    u.firstSeen = Math.min(u.firstSeen, seen);
    return u;
  };
  for (const e of etfs) {
    const u = user(e.manager, e.createdAt * 1000);
    u.etfsManaged++;
    u.aumManagedUsd += e.totalValueUsd;
    u.feesEarnedUsd += e.managerFeesUsd;
  }
  for (const a of agents) {
    const u = user(a.owner, a.createdAt);
    u.agents++;
    if (a.active) u.activeAgents++;
  }

  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const ti = rawAgents.length;
  const flagship = flagshipRes.value;
  if (flagshipRes.error) errors.push(`Flagship vault: ${flagshipRes.error}`);

  return {
    generatedAt: Date.now(),
    tookMs: Math.round(performance.now() - t0),
    health,
    config,
    runtime,
    analytics: {
      etfCount: etfs.length,
      totalAumUsd: sum(etfs.map((e) => e.totalValueUsd)),
      managerFeesUsd: sum(etfs.map((e) => e.managerFeesUsd)),
      protocolFeesUsd: sum(etfs.map((e) => e.protocolFeesUsd)),
      flagship: flagship ? { name: flagship.name, symbol: flagship.symbol, aumUsd: flagship.totalValueUsd, navPerShare: flagship.navPerShare } : null,
      agentCount: agents.length,
      activeAgents: agents.filter((a) => a.active).length,
      revokedAgents: agents.filter((a) => !a.active).length,
      agentFundsUsd: sum(agents.map((a) => a.cashBalance ?? 0)),
      uniqueUsers: users.size,
      listedStocks: STOCKS.filter((s) => s.address).length,
      cashSupply: cashSupplyRes.value ?? null,
      treasury: extra.length ? { address: extra[0], eth: ethB[ti] ?? null, cash: cashB[ti] ?? null } : null,
      signer: signerRes.value ?? null,
      etfsPerWeek: weekly(etfs.map((e) => e.createdAt * 1000)),
      agentsPerWeek: weekly(agents.map((a) => a.createdAt)),
    },
    etfs: [...etfs].sort((a, b) => b.totalValueUsd - a.totalValueUsd),
    agents: [...agents].reverse(),
    users: [...users.values()].sort((a, b) => b.aumManagedUsd - a.aumManagedUsd || b.agents - a.agents),
    errors,
  };
}

export function fmtAge(sec: number) {
  if (sec < 90) return `${sec}s`;
  if (sec < 5400) return `${Math.round(sec / 60)}m`;
  if (sec < 172800) return `${Math.round(sec / 3600)}h`;
  return `${Math.round(sec / 86400)}d`;
}
