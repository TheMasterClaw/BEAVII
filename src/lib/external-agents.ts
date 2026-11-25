/**
 * External agent gateway: third-party agents (Hermes, OpenClaw, Grok bots, custom LLM loops) each get their OWN
 * account — a wallet derived for that agent, owned by the user who created it in /dashboard/agents.
 *
 * An agent can only move value in two ways:
 *  1. Funds the owner transferred into the agent wallet (tUSDC, ETF shares).
 *  2. Funds the owner explicitly allowed on-chain: a tUSDC allowance (buy for the owner), an ETF-share allowance
 *     (sell for the owner) or setAgentAuthorization on an ETF the owner manages (rebalance it).
 * Results of trades made with the owner's funds go straight back to the owner. The only outbound transfer an agent
 * can make is to its owner. Owners can revoke allowances on-chain or revoke the API key at any time.
 *
 * Served as REST (/api/agents/v1/tools/:name), MCP (/api/agents/v1/mcp) and OpenAPI (/api/agents/v1/openapi.json).
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { NextRequest } from 'next/server';
import { ethers } from 'ethers';
import { CASH_TOKEN, HAS_EXCHANGE, findStock } from '@/config/base-sepolia';
import { GET as getStocksRoute } from '@/app/api/stocks/route';
import { syncPrices } from '@/lib/stock-agent';
import { B20_ABI, STOCK_VAULT_ABI, getBaseSepoliaProvider, multicall } from '@/lib/stock-vault';
import { FACTORY_DEPLOYED, getEtfFactory, getEtfVault, isFactoryEtf, listEtfs, readEtfDetail } from '@/lib/etf';
import { agentStore, publicRecord, type AgentRecord } from '@/lib/agent-accounts/store';
import { agentWallet, ensureGas, withAgentLock } from '@/lib/agent-accounts/wallet';

// ---------------------------------------------------------------- keys

const KEY_RE = /^bva_([0-9a-f]{16})_([A-Za-z0-9_-]{32,})$/;
export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

/** New API key for an agent id. Returns the key (show once) and its hash (store). */
export function newAgentKey(agentId: string) {
  const key = `bva_${agentId}_${randomBytes(32).toString('base64url')}`;
  return { key, hash: hashKey(key), prefix: key.slice(0, 26) };
}

export type AgentContext = { rec: AgentRecord; wallet: ethers.Wallet };

/** Resolve the calling agent from `Authorization: Bearer <key>` or `X-API-Key: <key>`. Revoked keys fail. */
export async function authenticateAgent(req: Request): Promise<AgentContext | null> {
  const header = req.headers.get('authorization') ?? '';
  const key = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : (req.headers.get('x-api-key') ?? '').trim();
  const m = KEY_RE.exec(key);
  if (!m) return null;
  const rec = await agentStore().get(m[1]);
  if (!rec || rec.revokedAt || !rec.keyHash) return null;
  const got = Buffer.from(hashKey(key), 'hex');
  const want = Buffer.from(rec.keyHash, 'hex');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  return { rec, wallet: agentWallet(rec.id) };
}

// ---------------------------------------------------------------- rate limiting (per server instance)

type Kind = 'read' | 'write';
const WINDOWS: Record<Kind, { limit: number; ms: number }> = { read: { limit: 60, ms: 60_000 }, write: { limit: 10, ms: 60_000 } };
const hits = new Map<string, number[]>();

function rateLimited(agentId: string, kind: Kind): number | null {
  const { limit, ms } = WINDOWS[kind];
  const key = `${agentId}:${kind}`;
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < ms);
  if (recent.length >= limit) return Math.ceil((recent[0] + ms - now) / 1000);
  recent.push(now);
  hits.set(key, recent);
  return null;
}

// ---------------------------------------------------------------- chain helpers

export class ToolError extends Error {
  constructor(message: string, public status = 400, public retryAfter?: number) {
    super(message);
  }
}

const CASH_ABI = [...B20_ABI, 'function transferFrom(address from, address to, uint256 amount) returns (bool)'];
const cashIface = new ethers.Interface(CASH_ABI);
const vaultIface = new ethers.Interface(STOCK_VAULT_ABI);
const ZERO = BigInt(0);
const CASH_DEC = CASH_TOKEN.decimals;

const cash = (runner: ethers.ContractRunner = getBaseSepoliaProvider()) => {
  if (!CASH_TOKEN.address) throw new ToolError('tUSDC is not deployed yet', 503);
  return new ethers.Contract(CASH_TOKEN.address, CASH_ABI, runner);
};
const toCash = (usd: number) => ethers.parseUnits(usd.toFixed(CASH_DEC), CASH_DEC);
const fromCash = (v: bigint) => Number(ethers.formatUnits(v, CASH_DEC));

const REVERTS: Record<string, string> = {
  StalePrice: 'a stock price is out of date: call sync_prices, then retry',
  NotAgent: 'this agent is not authorized on that ETF: the ETF manager must allow it in /dashboard/agents',
  OwnableUnauthorizedAccount: 'only the ETF manager can do this',
  EnforcedPause: 'this ETF is paused',
  Slippage: 'cash out was below minCashOut',
  BadWeights: 'weights across the whole basket must total 10000 bps',
  UnknownAsset: 'a stock is not in this ETF',
  ZeroAmount: 'amount is too small',
};

/** Wait for a tx and turn reverts into readable tool errors. */
async function send(p: Promise<ethers.ContractTransactionResponse | ethers.TransactionResponse>) {
  try {
    const tx = await p;
    const r = await tx.wait();
    if (!r || r.status !== 1) throw new ToolError(`transaction ${tx.hash} failed`, 502);
    return r;
  } catch (e) {
    if (e instanceof ToolError) throw e;
    const err = e as { revert?: { name?: string }; shortMessage?: string; message?: string };
    const name = err.revert?.name;
    throw new ToolError(name ? REVERTS[name] ?? name : err.shortMessage ?? err.message ?? 'transaction failed', 422);
  }
}

function eventArg(r: ethers.TransactionReceipt, address: string, event: string, arg: string): bigint {
  for (const log of r.logs) {
    if (log.address.toLowerCase() !== address.toLowerCase()) continue;
    try {
      const ev = vaultIface.parseLog(log);
      if (ev?.name === event) return ev.args[arg] as bigint;
    } catch {
      // other event
    }
  }
  throw new ToolError(`${event} event not found`, 502);
}

async function etfArg(v: unknown) {
  const a = typeof v === 'string' ? v : '';
  if (!ethers.isAddress(a)) throw new ToolError('etf must be an ETF vault address (see list_etfs)');
  if (!(await isFactoryEtf(a))) throw new ToolError('etf is not a BEAVII ETF', 404);
  return ethers.getAddress(a);
}

function positiveNumber(v: unknown, field: string) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new ToolError(`${field} must be a positive number`);
  return n;
}

function checkLimit(ctx: AgentContext, usd: number) {
  const max = ctx.rec.limits.maxTradeUsd;
  if (max !== null && usd > max + 1e-9) throw new ToolError(`trade of $${usd.toFixed(2)} exceeds this agent's limit of $${max} (owner can change it)`, 403);
}

// ---------------------------------------------------------------- account status

/** Everything an agent (or its owner) needs to know about the account and its permissions. */
export async function accountStatus(rec: AgentRecord) {
  const agent = rec.address;
  const owner = rec.owner;
  const etfs: string[] = FACTORY_DEPLOYED ? [...(await getEtfFactory().allETFs())] : [];
  const cashCalls = CASH_TOKEN.address
    ? [
        { target: CASH_TOKEN.address, iface: cashIface, fn: 'balanceOf', args: [agent] },
        { target: CASH_TOKEN.address, iface: cashIface, fn: 'balanceOf', args: [owner] },
        { target: CASH_TOKEN.address, iface: cashIface, fn: 'allowance', args: [owner, agent] },
      ]
    : [];
  const PER = 8;
  const etfCalls = etfs.flatMap((e) => [
    { target: e, iface: vaultIface, fn: 'symbol' },
    { target: e, iface: vaultIface, fn: 'owner' },
    { target: e, iface: vaultIface, fn: 'getNetAssetValue' },
    { target: e, iface: vaultIface, fn: 'balanceOf', args: [agent] },
    { target: e, iface: vaultIface, fn: 'balanceOf', args: [owner] },
    { target: e, iface: vaultIface, fn: 'allowance', args: [owner, agent] },
    { target: e, iface: vaultIface, fn: 'authorizedAgents', args: [agent] },
    { target: e, iface: vaultIface, fn: 'name' },
  ]);
  const [eth, results] = await Promise.all([getBaseSepoliaProvider().getBalance(agent), multicall<unknown>([...cashCalls, ...etfCalls])]);
  const c = results.slice(0, cashCalls.length) as (bigint | null)[];
  const rows = etfs.map((address, i) => {
    const r = results.slice(cashCalls.length + i * PER, cashCalls.length + (i + 1) * PER);
    const nav = Number(ethers.formatEther((r[2] as bigint | null) ?? ZERO));
    const manager = String(r[1] ?? '').toLowerCase();
    const agentShares = Number(ethers.formatEther((r[3] as bigint | null) ?? ZERO));
    const ownerShares = Number(ethers.formatEther((r[4] as bigint | null) ?? ZERO));
    return {
      address,
      name: (r[7] as string | null) ?? '',
      symbol: (r[0] as string | null) ?? '',
      navPerShare: nav,
      agentShares,
      agentValueUsd: agentShares * nav,
      ownerShares,
      ownerSharesAllowedToSell: Number(ethers.formatEther((r[5] as bigint | null) ?? ZERO)),
      ownerIsManager: manager === owner,
      agentIsManager: manager === agent.toLowerCase(),
      canRebalance: Boolean(r[6]) || manager === agent.toLowerCase(),
    };
  });
  return {
    account: publicRecord(rec),
    wallet: {
      address: agent,
      eth: Number(ethers.formatEther(eth)),
      cash: c[0] != null ? fromCash(c[0]) : 0,
      cashSymbol: CASH_TOKEN.symbol,
    },
    owner: {
      address: owner,
      cash: c[1] != null ? fromCash(c[1]) : 0,
      cashAllowedToSpend: c[2] != null ? fromCash(c[2]) : 0,
    },
    etfs: rows,
  };
}

/** Send funds from the agent wallet to its owner (the only destination agent funds can go to). */
export async function sendToOwner(ctx: AgentContext, asset: string, amount: number | 'all') {
  const { wallet, rec } = ctx;
  return withAgentLock(wallet.address, async () => {
    if (asset === 'eth') {
      const bal = await getBaseSepoliaProvider().getBalance(wallet.address);
      const reserve = ethers.parseEther('0.0001');
      const value = amount === 'all' ? bal - reserve : ethers.parseEther(String(amount));
      if (value <= ZERO || value > bal - reserve) throw new ToolError('not enough ETH (keeps 0.0001 for gas)');
      const r = await send(wallet.sendTransaction({ to: rec.owner, value }));
      return { asset: 'eth', amount: ethers.formatEther(value), to: rec.owner, txHash: r.hash };
    }
    const gasTx = await ensureGas(wallet.address);
    if (asset === 'cash') {
      const token = cash(wallet);
      const bal: bigint = await token.balanceOf(wallet.address);
      const value = amount === 'all' ? bal : toCash(amount);
      if (value <= ZERO || value > bal) throw new ToolError(`not enough ${CASH_TOKEN.symbol} (has ${fromCash(bal)})`);
      const r = await send(token.transfer(rec.owner, value));
      return { asset: CASH_TOKEN.symbol, amount: fromCash(value), to: rec.owner, txHash: r.hash, gasTopUp: gasTx };
    }
    const etf = await etfArg(asset);
    const vault = getEtfVault(etf, wallet);
    const bal: bigint = await vault.balanceOf(wallet.address);
    const value = amount === 'all' ? bal : ethers.parseEther(String(amount));
    if (value <= ZERO || value > bal) throw new ToolError(`not enough shares (has ${ethers.formatEther(bal)})`);
    const r = await send(vault.transfer(rec.owner, value));
    return { asset: etf, shares: ethers.formatEther(value), to: rec.owner, txHash: r.hash, gasTopUp: gasTx };
  });
}

// ---------------------------------------------------------------- tools

type Args = Record<string, unknown>;
export type AgentTool = {
  name: string;
  description: string;
  kind: Kind;
  inputSchema: Record<string, unknown>;
  run: (args: Args, ctx: AgentContext) => Promise<unknown>;
};

type StockRow = { symbol: string; testSymbol: string; name: string; inBasket: boolean; [k: string]: unknown };

async function readStocks() {
  const res = await getStocksRoute(new NextRequest(new URL('http://internal/api/stocks')));
  const body = (await res.json()) as { stocks?: StockRow[]; network?: unknown; error?: string };
  if (!res.ok) throw new ToolError(body.error ?? 'failed to read market state', res.status);
  return body;
}

const ETF = { type: 'string', description: 'ETF vault address (from list_etfs or get_account)' };
const NO_ARGS = { type: 'object', properties: {}, additionalProperties: false };
const SYNC_INTERVAL_MS = 2 * 60 * 1000;
let lastSync = 0;

export const AGENT_TOOLS: AgentTool[] = [
  {
    name: 'get_account',
    description:
      "Your own account: wallet address, ETH (gas) and tUSDC balances, your trade limit, what your owner allows you to spend " +
      '(owner.cashAllowedToSpend) and, per ETF, your shares, owner shares you may sell, and whether you may rebalance it. Call this first.',
    kind: 'read',
    inputSchema: NO_ARGS,
    run: async (_a, ctx) => {
      const s = await accountStatus(ctx.rec);
      return { ...s, etfs: s.etfs.filter((e) => e.agentShares > 0 || e.ownerShares > 0 || e.canRebalance || e.ownerIsManager) };
    },
  },
  {
    name: 'list_etfs',
    description: 'All BEAVII ETFs (stock baskets on Base Sepolia) with AUM, NAV per share, fees and manager.',
    kind: 'read',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 } }, additionalProperties: false },
    run: async (a) => {
      const list = await listEtfs();
      const limit = Math.min(Math.max(Number(a.limit) || 25, 1), 100);
      return { total: list.length, etfs: list.slice(0, limit) };
    },
  },
  {
    name: 'get_etf',
    description: 'One ETF in detail: holdings with target vs actual weights, prices and their age, fees, and your position in it.',
    kind: 'read',
    inputSchema: { type: 'object', properties: { etf: ETF }, required: ['etf'], additionalProperties: false },
    run: async (a, ctx) => readEtfDetail(await etfArg(a.etf), ctx.wallet.address),
  },
  {
    name: 'get_stock_market',
    description:
      'Tokenized stocks with live price, on-chain exchange price and 24h stats. Filter with `symbols` (e.g. ["TSLAc"]) or `query`.',
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        symbols: { type: 'array', items: { type: 'string' } },
        query: { type: 'string', description: 'Case-insensitive substring of symbol or name' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
      },
      additionalProperties: false,
    },
    run: async (a) => {
      const data = await readStocks();
      const wanted = Array.isArray(a.symbols) ? new Set(a.symbols.map((s) => String(s).toLowerCase())) : null;
      const q = typeof a.query === 'string' ? a.query.toLowerCase() : '';
      const limit = Math.min(Math.max(Number(a.limit) || 25, 1), 100);
      const rows = (data.stocks ?? []).filter(
        (s) =>
          (!wanted || wanted.has(s.symbol.toLowerCase()) || wanted.has(s.testSymbol.toLowerCase())) &&
          (!q || s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)),
      );
      return { total: rows.length, stocks: rows.slice(0, limit) };
    },
  },
  {
    name: 'sync_prices',
    description: 'Push fresh stock prices on-chain. Needed when a trade fails with "price is out of date". Runs at most every 2 minutes.',
    kind: 'write',
    inputSchema: NO_ARGS,
    run: async () => {
      if (!HAS_EXCHANGE) throw new ToolError('StockExchange not deployed', 503);
      if (Date.now() - lastSync < SYNC_INTERVAL_MS) return { skipped: 'prices synced in the last 2 minutes' };
      lastSync = Date.now();
      return syncPrices();
    },
  },
  {
    name: 'buy_etf',
    description:
      'Buy ETF shares with tUSDC at NAV. fundsFrom "agent" spends your own balance (shares stay with you). fundsFrom "owner" ' +
      "spends from your owner's wallet within the allowance they granted, and the shares go straight to the owner.",
    kind: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        etf: ETF,
        amountUsd: { type: 'number', exclusiveMinimum: 0, description: 'tUSDC to spend (1 tUSDC = $1)' },
        fundsFrom: { type: 'string', enum: ['agent', 'owner'], default: 'agent' },
      },
      required: ['etf', 'amountUsd'],
      additionalProperties: false,
    },
    run: async (a, ctx) => {
      const etf = await etfArg(a.etf);
      const usd = positiveNumber(a.amountUsd, 'amountUsd');
      checkLimit(ctx, usd);
      const fromOwner = a.fundsFrom === 'owner';
      const amount = toCash(usd);
      const { wallet, rec } = ctx;
      const me = wallet.address;
      return withAgentLock(me, async () => {
        const token = cash(wallet);
        const vault = getEtfVault(etf, wallet);
        const txs: Record<string, string> = {};
        if (fromOwner) {
          const [allowed, bal]: bigint[] = await Promise.all([token.allowance(rec.owner, me), token.balanceOf(rec.owner)]);
          if (allowed < amount) throw new ToolError(`owner allows you to spend only ${fromCash(allowed)} ${CASH_TOKEN.symbol}`, 403);
          if (bal < amount) throw new ToolError(`owner has only ${fromCash(bal)} ${CASH_TOKEN.symbol}`);
        } else {
          const bal: bigint = await token.balanceOf(me);
          if (bal < amount) throw new ToolError(`your wallet has only ${fromCash(bal)} ${CASH_TOKEN.symbol}; ask your owner to fund ${me}`);
        }
        // Only sponsor gas once the trade is known to be possible.
        const gasTopUp = await ensureGas(me);
        if (fromOwner) txs.pullFromOwner = (await send(token.transferFrom(rec.owner, me, amount))).hash;
        let shares = ZERO;
        try {
          if ((await token.allowance(me, etf)) < amount) txs.approve = (await send(token.approve(etf, ethers.MaxUint256))).hash;
          const r = await send(vault.deposit(CASH_TOKEN.address, amount));
          txs.deposit = r.hash;
          shares = eventArg(r, etf, 'Deposited', 'shares');
        } catch (e) {
          if (fromOwner) {
            // Nothing was bought: give the owner their cash back.
            txs.refundOwner = await send(token.transfer(rec.owner, amount)).then((r) => r.hash, () => 'failed: use withdraw_to_owner');
          }
          throw new ToolError(`${(e as Error).message}${txs.refundOwner ? ` (refund: ${txs.refundOwner})` : ''}`, (e as ToolError).status ?? 500);
        }
        if (fromOwner) {
          try {
            txs.deliverToOwner = (await send(vault.transfer(rec.owner, shares))).hash;
          } catch (e) {
            throw new ToolError(`bought ${ethers.formatEther(shares)} shares but could not deliver them to the owner (${(e as Error).message}); they are in the agent wallet, use withdraw_to_owner`, 502);
          }
        }
        return { etf, spentUsd: usd, shares: ethers.formatEther(shares), sharesHeldBy: fromOwner ? rec.owner : me, txs, gasTopUp };
      });
    },
  },
  {
    name: 'sell_etf',
    description:
      'Redeem ETF shares for tUSDC at NAV. sharesOf "agent" sells your own shares (cash stays with you). sharesOf "owner" sells ' +
      "your owner's shares within the allowance they granted, and the cash goes straight to the owner. Pass `shares` or `all: true`.",
    kind: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        etf: ETF,
        shares: { type: 'number', exclusiveMinimum: 0 },
        all: { type: 'boolean', description: 'Sell everything available (owner: up to the allowance)' },
        sharesOf: { type: 'string', enum: ['agent', 'owner'], default: 'agent' },
        minCashOut: { type: 'number', minimum: 0, description: 'Revert if less tUSDC would come out' },
      },
      required: ['etf'],
      additionalProperties: false,
    },
    run: async (a, ctx) => {
      const etf = await etfArg(a.etf);
      const ofOwner = a.sharesOf === 'owner';
      const { wallet, rec } = ctx;
      const me = wallet.address;
      return withAgentLock(me, async () => {
        const vault = getEtfVault(etf, wallet);
        const [nav, mine, ownerBal, allowed]: bigint[] = await Promise.all([
          vault.getNetAssetValue(),
          vault.balanceOf(me),
          vault.balanceOf(rec.owner),
          vault.allowance(rec.owner, me),
        ]);
        const available = ofOwner ? (ownerBal < allowed ? ownerBal : allowed) : mine;
        const shares = a.all ? available : ethers.parseEther(String(positiveNumber(a.shares, 'shares')));
        if (shares <= ZERO) throw new ToolError(ofOwner ? 'owner has not allowed you to sell any shares of this ETF' : 'you hold no shares of this ETF');
        if (shares > available) {
          throw new ToolError(`only ${ethers.formatEther(available)} shares available${ofOwner ? ' (owner balance / allowance)' : ''}`, ofOwner ? 403 : 400);
        }
        checkLimit(ctx, Number(ethers.formatEther((shares * nav) / ethers.WeiPerEther)));
        const gasTopUp = await ensureGas(me);
        const txs: Record<string, string> = {};
        if (ofOwner) txs.pullFromOwner = (await send(vault.transferFrom(rec.owner, me, shares))).hash;
        let out = ZERO;
        try {
          const minOut = a.minCashOut ? toCash(Number(a.minCashOut)) : ZERO;
          const r = await send(vault.withdraw(shares, CASH_TOKEN.address, minOut));
          txs.withdraw = r.hash;
          out = eventArg(r, etf, 'Withdrawn', 'amountOut');
        } catch (e) {
          if (ofOwner) txs.refundOwner = await send(vault.transfer(rec.owner, shares)).then((r) => r.hash, () => 'failed: use withdraw_to_owner');
          throw new ToolError(`${(e as Error).message}${txs.refundOwner ? ` (refund: ${txs.refundOwner})` : ''}`, (e as ToolError).status ?? 500);
        }
        if (ofOwner) {
          try {
            txs.deliverToOwner = (await send(cash(wallet).transfer(rec.owner, out))).hash;
          } catch (e) {
            throw new ToolError(`sold for ${fromCash(out)} ${CASH_TOKEN.symbol} but could not deliver it to the owner (${(e as Error).message}); use withdraw_to_owner`, 502);
          }
        }
        return { etf, sharesSold: ethers.formatEther(shares), cashOut: fromCash(out), cashHeldBy: ofOwner ? rec.owner : me, txs, gasTopUp };
      });
    },
  },
  {
    name: 'rebalance_etf',
    description: 'Trade an ETF back to its target weights. Only works on ETFs whose manager authorized you (get_account → canRebalance).',
    kind: 'write',
    inputSchema: { type: 'object', properties: { etf: ETF }, required: ['etf'], additionalProperties: false },
    run: async (a, ctx) => {
      const etf = await etfArg(a.etf);
      const me = ctx.wallet.address;
      const vault = getEtfVault(etf, ctx.wallet);
      const [authorized, manager]: [boolean, string] = await Promise.all([vault.authorizedAgents(me), vault.owner()]);
      if (!authorized && manager.toLowerCase() !== me.toLowerCase()) {
        throw new ToolError('not authorized: the ETF manager must allow this agent to rebalance (dashboard → Agents)', 403);
      }
      return withAgentLock(me, async () => {
        const gasTopUp = await ensureGas(me);
        const r = await send(vault.rebalance());
        return { etf, txHash: r.hash, gasTopUp };
      });
    },
  },
  {
    name: 'set_etf_weights',
    description:
      'Change target weights of an ETF YOU manage (ownership transferred to your wallet). weights maps stock symbols to bps; ' +
      'the whole basket must total 10000. Then call rebalance_etf.',
    kind: 'write',
    inputSchema: {
      type: 'object',
      properties: { etf: ETF, weights: { type: 'object', additionalProperties: { type: 'integer', minimum: 0, maximum: 10000 } } },
      required: ['etf', 'weights'],
      additionalProperties: false,
    },
    run: async (a, ctx) => {
      const etf = await etfArg(a.etf);
      const me = ctx.wallet.address;
      const vault = getEtfVault(etf, ctx.wallet);
      if ((await vault.owner()).toLowerCase() !== me.toLowerCase()) throw new ToolError('you do not manage this ETF', 403);
      const entries = Object.entries((a.weights ?? {}) as Record<string, number>);
      if (!entries.length) throw new ToolError('weights is required');
      const tokens = entries.map(([s]) => findStock(s));
      const unknown = entries.filter((_, i) => !tokens[i]?.address).map(([s]) => s);
      if (unknown.length) throw new ToolError(`unknown stocks: ${unknown.join(', ')}`);
      return withAgentLock(me, async () => {
        const gasTopUp = await ensureGas(me);
        const r = await send(vault.setWeights(tokens.map((t) => t!.address), entries.map(([, w]) => BigInt(Math.round(Number(w))))));
        return { etf, txHash: r.hash, gasTopUp };
      });
    },
  },
  {
    name: 'withdraw_to_owner',
    description: 'Send funds from your wallet back to your owner. asset: "cash" (tUSDC), "eth", or an ETF address (shares).',
    kind: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        asset: { type: 'string', description: '"cash", "eth" or an ETF address' },
        amount: { description: 'Number, or "all"', oneOf: [{ type: 'number', exclusiveMinimum: 0 }, { const: 'all' }] },
      },
      required: ['asset', 'amount'],
      additionalProperties: false,
    },
    run: async (a, ctx) => sendToOwner(ctx, String(a.asset), a.amount === 'all' ? 'all' : positiveNumber(a.amount, 'amount')),
  },
];

/** Run a tool for an authenticated agent with rate limiting and an audit log line. */
export async function callTool(ctx: AgentContext, name: string, args: unknown = {}) {
  const tool = AGENT_TOOLS.find((t) => t.name === name);
  if (!tool) throw new ToolError(`unknown tool: ${name}`, 404);
  if (args === null || typeof args !== 'object' || Array.isArray(args)) throw new ToolError('arguments must be a JSON object');
  const wait = rateLimited(ctx.rec.id, tool.kind);
  if (wait !== null) throw new ToolError(`rate limited, retry in ${wait}s`, 429, wait);
  const started = Date.now();
  try {
    const result = await tool.run(args as Args, ctx);
    console.info(`[agent-gateway] ${ctx.rec.id} (${ctx.rec.name}, owner ${ctx.rec.owner}) ${name} ok ${Date.now() - started}ms`);
    return result;
  } catch (e) {
    console.warn(`[agent-gateway] ${ctx.rec.id} ${name} failed: ${(e as Error).message}`);
    if (e instanceof ToolError) throw e;
    throw new ToolError((e as Error).message, 500);
  }
}

/** OpenAI / xAI / Hermes function-calling format. */
export function asFunctionSchemas(tools: AgentTool[] = AGENT_TOOLS) {
  return tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
}
