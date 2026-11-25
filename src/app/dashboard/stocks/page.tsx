'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ethers } from 'ethers';
import { ExternalLink, RefreshCw, Wallet, Droplets, ArrowDownToLine, ArrowUpFromLine, Activity } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  BASE_SEPOLIA,
  BASE_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID_HEX,
  BASE_SEPOLIA_WALLET_PARAMS,
  CASH_TOKEN,
  STOCK_VAULT,
  explorerUrl,
} from '@/config/base-sepolia';
import { B20_ABI, STOCK_VAULT_ABI } from '@/lib/stock-vault';

interface StockRow {
  symbol: string;
  testSymbol: string;
  name: string;
  address: string;
  mainnetAddress: string;
  decimals: number;
  iconUrl?: string;
  isin?: string;
  livePrice: number | null;
  priceSource: 'nav' | 'market' | null;
  listed: boolean;
  userBalance: string;
  onchainPrice: number | null;
  onchainPriceAgeSec: number | null;
  inBasket: boolean;
  targetWeightBps: number;
  vaultBalance: string;
  vaultValueUsd: number;
}

interface StocksResponse {
  deployed: boolean;
  hasExchange: boolean;
  tokensCreated: number;
  cashToken: { symbol: string; address: string; decimals: number };
  hint?: string;
  error?: string;
  network: { faucetUrl: string };
  vault: null | {
    address: string;
    name: string;
    symbol: string;
    totalValueUsd: number;
    navPerShare: number;
    totalShares: string;
    lastRebalance: number;
  };
  stocks: StockRow[];
  user: null | { cash: string; shares?: string; sharesValueUsd?: number };
}

type Eip1193 = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown>; on?: (e: string, cb: (...a: unknown[]) => void) => void; removeListener?: (e: string, cb: (...a: unknown[]) => void) => void };

const usd = (n: number | null | undefined, max = 2) =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: max });
const qty = (s: string | number, max = 4) => Number(s).toLocaleString('en-US', { maximumFractionDigits: max });
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function getInjected(): Eip1193 | null {
  return typeof window !== 'undefined' ? ((window as unknown as { ethereum?: Eip1193 }).ethereum ?? null) : null;
}

export default function TokenizedStocksPage() {
  const [data, setData] = useState<StocksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [account, setAccount] = useState('');
  const [chainId, setChainId] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; msg: string; tx?: string } | null>(null);
  const [depositAmt, setDepositAmt] = useState('100');
  const [redeemAmt, setRedeemAmt] = useState('');
  const [redeemInKind, setRedeemInKind] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'held' | 'nav' | 'basket'>('all');
  const [page, setPage] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/stocks${account ? `?address=${account}` : ''}`, { cache: 'no-store' });
      setData(await res.json());
    } catch (e) {
      setStatus({ kind: 'err', msg: `Could not load stocks: ${(e as Error).message}` });
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  // Track injected wallet account / chain
  useEffect(() => {
    const eth = getInjected();
    if (!eth) return;
    eth.request({ method: 'eth_accounts' }).then((a) => setAccount(((a as string[])[0] ?? '').toLowerCase())).catch(() => {});
    eth.request({ method: 'eth_chainId' }).then((c) => setChainId(parseInt(c as string, 16))).catch(() => {});
    const onAccounts = (a: unknown) => setAccount((((a as string[]) ?? [])[0] ?? '').toLowerCase());
    const onChain = (c: unknown) => setChainId(parseInt(c as string, 16));
    eth.on?.('accountsChanged', onAccounts);
    eth.on?.('chainChanged', onChain);
    return () => {
      eth.removeListener?.('accountsChanged', onAccounts);
      eth.removeListener?.('chainChanged', onChain);
    };
  }, []);

  const ensureBaseSepolia = async (eth: Eip1193) => {
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: BASE_SEPOLIA_CHAIN_ID_HEX }] });
    } catch (e) {
      if ((e as { code?: number }).code === 4902) {
        await eth.request({ method: 'wallet_addEthereumChain', params: [BASE_SEPOLIA_WALLET_PARAMS] });
      } else throw e;
    }
    setChainId(BASE_SEPOLIA_CHAIN_ID);
  };

  const connect = async () => {
    const eth = getInjected();
    if (!eth) {
      setStatus({ kind: 'err', msg: 'No browser wallet found. Install Coinbase Wallet or MetaMask.' });
      return;
    }
    try {
      const accts = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
      setAccount(accts[0].toLowerCase());
      await ensureBaseSepolia(eth);
    } catch (e) {
      setStatus({ kind: 'err', msg: (e as Error).message });
    }
  };

  const getSigner = async () => {
    const eth = getInjected();
    if (!eth) throw new Error('No browser wallet');
    await ensureBaseSepolia(eth);
    return new ethers.BrowserProvider(eth as ethers.Eip1193Provider).getSigner();
  };

  const run = async (label: string, fn: () => Promise<string | undefined>) => {
    setBusy(label);
    setStatus(null);
    try {
      const tx = await fn();
      setStatus({ kind: 'ok', msg: `${label} confirmed`, tx });
      await load();
    } catch (e) {
      const err = e as { shortMessage?: string; reason?: string; message?: string };
      setStatus({ kind: 'err', msg: `${label} failed: ${err.reason ?? err.shortMessage ?? err.message}` });
    } finally {
      setBusy(null);
    }
  };

  const claimFaucet = (stock?: string) =>
    run('Faucet', async () => {
      const res = await fetch('/api/stocks/faucet', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address: account, stock }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      return body.txHashes?.[0];
    });

  const syncPrices = () =>
    run('NAV sync', async () => {
      const res = await fetch('/api/stocks/agent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'sync-prices' }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      return body.txHash;
    });

  const deposit = () =>
    run('Deposit', async () => {
      const signer = await getSigner();
      const amount = ethers.parseUnits(depositAmt, CASH_TOKEN.decimals);
      const cash = new ethers.Contract(CASH_TOKEN.address, B20_ABI, signer);
      const allowance: bigint = await cash.allowance(account, STOCK_VAULT.address);
      if (allowance < amount) await (await cash.approve(STOCK_VAULT.address, amount)).wait();
      const vault = new ethers.Contract(STOCK_VAULT.address, STOCK_VAULT_ABI, signer);
      const tx = await vault.deposit(CASH_TOKEN.address, amount);
      await tx.wait();
      return tx.hash;
    });

  const redeem = () =>
    run('Redeem', async () => {
      const signer = await getSigner();
      const vault = new ethers.Contract(STOCK_VAULT.address, STOCK_VAULT_ABI, signer);
      const shares = ethers.parseEther(redeemAmt);
      const tx = await vault.withdraw(shares, redeemInKind ? ethers.ZeroAddress : CASH_TOKEN.address, 0);
      await tx.wait();
      setRedeemAmt('');
      return tx.hash;
    });

  const basket = useMemo(() => (data?.stocks ?? []).filter((s) => s.inBasket), [data]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.stocks ?? []).filter((s) => {
      if (filter === 'held' && !(Number(s.userBalance) > 0)) return false;
      if (filter === 'nav' && s.priceSource !== 'nav') return false;
      if (filter === 'basket' && !s.inBasket) return false;
      return !q || s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q) || (s.isin ?? '').toLowerCase().includes(q);
    });
  }, [data, query, filter]);
  const PAGE = 50;
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const pageRows = filtered.slice(page * PAGE, page * PAGE + PAGE);
  useEffect(() => setPage(0), [query, filter]);
  const wrongChain = account && chainId !== null && chainId !== BASE_SEPOLIA_CHAIN_ID;
  const stalest = Math.max(0, ...basket.map((s) => s.onchainPriceAgeSec ?? 0));
  const canTransact = Boolean(account && data?.deployed && !busy);
  const canFaucet = Boolean(account && data?.cashToken?.address && !busy);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold tracking-tight">Tokenized Stocks</h1>
            <Badge variant="outline">Base Sepolia · {BASE_SEPOLIA_CHAIN_ID}</Badge>
          </div>
          <p className="text-muted-foreground mt-1 max-w-2xl">
            A stock-basket ETF built on Base B-20 asset tokens. Test tokens mirror Coinbase tokenized stocks on Base and
            are priced at their live NAV from the Tokenized Stocks API.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          {account ? (
            <Badge variant={wrongChain ? 'destructive' : 'secondary'} className="font-mono">
              {wrongChain ? 'Wrong network' : short(account)}
            </Badge>
          ) : (
            <Button size="sm" onClick={connect}>
              <Wallet className="h-4 w-4 mr-1" /> Connect wallet
            </Button>
          )}
          {wrongChain && (
            <Button size="sm" onClick={() => getInjected() && ensureBaseSepolia(getInjected()!)}>
              Switch to Base Sepolia
            </Button>
          )}
        </div>
      </div>

      {status && (
        <div
          role="status"
          className={`rounded-md border px-4 py-3 text-sm ${status.kind === 'ok' ? 'border-green-500/40 bg-green-500/10' : 'border-red-500/40 bg-red-500/10'}`}
        >
          {status.msg}
          {status.tx && (
            <a className="ml-2 underline" href={explorerUrl(status.tx, 'tx')} target="_blank" rel="noreferrer">
              View transaction
            </a>
          )}
        </div>
      )}

      {data && !data.deployed && !data.tokensCreated && (
        <Card>
          <CardHeader>
            <CardTitle>Contracts not deployed yet</CardTitle>
            <CardDescription>{data.hint}</CardDescription>
          </CardHeader>
        </Card>
      )}
      {data?.error && <p className="text-sm text-red-500">{data.error}</p>}

      {data?.vault && (
        <div className="grid gap-4 md:grid-cols-4">
          <Stat label="Vault TVL" value={usd(data.vault.totalValueUsd)} />
          <Stat label={`NAV per ${data.vault.symbol}`} value={usd(data.vault.navPerShare, 4)} />
          <Stat label="Your shares" value={data.user?.shares ? qty(data.user.shares) : '—'} sub={data.user ? usd(data.user.sharesValueUsd ?? 0) : 'Connect a wallet'} />
          <Stat label="Your tUSDC" value={data.user ? qty(data.user.cash, 2) : '—'} />
        </div>
      )}

      {(data?.deployed || data?.cashToken?.address) && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Droplets className="h-4 w-4" /> Testnet funds</CardTitle>
              <CardDescription>
                You need Base Sepolia ETH for gas (
                <a className="underline" href={data.network.faucetUrl} target="_blank" rel="noreferrer">CDP faucet</a>
                ), then mint test cash here.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button className="w-full" disabled={!canFaucet} onClick={() => claimFaucet()}>
                {busy === 'Faucet' ? 'Minting…' : 'Get 1,000 tUSDC'}
              </Button>
              <p className="text-xs text-muted-foreground">Or use “+$250” on any stock below to get tUSDC plus that stock.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><ArrowDownToLine className="h-4 w-4" /> Buy the basket</CardTitle>
              <CardDescription>Deposit tUSDC. The vault issues each stock at NAV by target weight.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex gap-2">
                <Input inputMode="decimal" value={depositAmt} onChange={(e) => setDepositAmt(e.target.value)} aria-label="tUSDC amount" />
                <span className="self-center text-sm text-muted-foreground">tUSDC</span>
              </div>
              <Button className="w-full" disabled={!canTransact || !(Number(depositAmt) > 0)} onClick={deposit}>
                {busy === 'Deposit' ? 'Confirm in wallet…' : 'Approve & deposit'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><ArrowUpFromLine className="h-4 w-4" /> Redeem</CardTitle>
              <CardDescription>Burn shares for tUSDC at NAV, or take the stocks in kind.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex gap-2">
                <Input inputMode="decimal" placeholder="Shares" value={redeemAmt} onChange={(e) => setRedeemAmt(e.target.value)} aria-label="Shares to redeem" />
                <Button variant="outline" size="sm" className="self-center" disabled={!data.user?.shares} onClick={() => setRedeemAmt(data.user?.shares ?? '')}>Max</Button>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={redeemInKind} onChange={(e) => setRedeemInKind(e.target.checked)} />
                Redeem in kind (receive the stock tokens)
              </label>
              <Button className="w-full" disabled={!canTransact || !(Number(redeemAmt) > 0)} onClick={redeem}>
                {busy === 'Redeem' ? 'Confirm in wallet…' : 'Redeem'}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {data?.vault && (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>{data.vault.name}</CardTitle>
              <CardDescription>
                Vault{' '}
                <a className="underline font-mono" href={explorerUrl(data.vault.address)} target="_blank" rel="noreferrer">{short(data.vault.address)}</a>
                {' · '}onchain prices are {stalest ? `${Math.round(stalest / 60)} min` : '—'} old
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={syncPrices} disabled={!!busy}>
              <Activity className="h-4 w-4 mr-1" /> {busy === 'NAV sync' ? 'Syncing…' : 'Sync NAV'}
            </Button>
          </CardHeader>
          <CardContent>
            <StockTable rows={basket} showWeights />
          </CardContent>
        </Card>
      )}

      {data && data.stocks.length > 0 && (
        <Card>
          <CardHeader className="gap-3">
            <div className="flex flex-col gap-1 md:flex-row md:items-baseline md:justify-between">
              <CardTitle className="text-base">All tokenized stocks on Base ({data.stocks.length})</CardTitle>
              <CardDescription>
                {data.tokensCreated
                  ? `${data.tokensCreated} test mirrors on Base Sepolia`
                  : 'Test mirrors not created yet. Showing the Base mainnet catalog with live prices.'}
              </CardDescription>
            </div>
            <div className="flex flex-col gap-2 md:flex-row">
              <Input placeholder="Search ticker, company or ISIN" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search stocks" className="md:max-w-xs" />
              <div className="flex gap-1" role="group" aria-label="Filter">
                {(['all', 'held', 'nav', 'basket'] as const).map((f) => (
                  <Button key={f} size="sm" variant={filter === f ? 'default' : 'outline'} onClick={() => setFilter(f)}>
                    {{ all: 'All', held: 'I hold', nav: 'NAV-priced', basket: 'In basket' }[f]}
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <StockTable rows={pageRows} onDrip={canFaucet ? (sym) => claimFaucet(sym) : undefined} />
            <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
              <span className="tabular-nums">
                {filtered.length ? `${page * PAGE + 1}–${Math.min(filtered.length, (page + 1) * PAGE)} of ${filtered.length}` : 'No matches'}
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                <Button size="sm" variant="outline" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        Testnet only. Test tokens have no value and are not offers of any security. Mainnet Coinbase tokenized stocks are
        available only to eligible persons outside the United States.
      </p>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        {sub && <p className="text-xs text-muted-foreground tabular-nums">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function StockTable({ rows, showWeights, onDrip }: { rows: StockRow[]; showWeights?: boolean; onDrip?: (symbol: string) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground">
          <tr className="border-b">
            <th className="py-2 pr-4 font-medium">Stock</th>
            {showWeights && <th className="py-2 pr-4 font-medium text-right">Weight</th>}
            <th className="py-2 pr-4 font-medium text-right">Live price</th>
            <th className="py-2 pr-4 font-medium text-right">Vault price</th>
            {showWeights && <th className="py-2 pr-4 font-medium text-right">Vault holds</th>}
            {showWeights && <th className="py-2 pr-4 font-medium text-right">Value</th>}
            <th className="py-2 pr-4 font-medium text-right">You hold</th>
            <th className="py-2 font-medium text-right">Contracts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.address} className="border-b last:border-0">
              <td className="py-2 pr-4">
                <div className="flex items-center gap-2">
                  {s.iconUrl && <img src={s.iconUrl} alt="" width={24} height={24} className="rounded-full" />}
                  <div>
                    <div className="font-medium">{s.testSymbol}</div>
                    <div className="text-xs text-muted-foreground">{s.name}</div>
                  </div>
                </div>
              </td>
              {showWeights && <td className="py-2 pr-4 text-right tabular-nums">{(s.targetWeightBps / 100).toFixed(2)}%</td>}
              <td className="py-2 pr-4 text-right tabular-nums">
                {usd(s.livePrice)}
                {s.priceSource && (
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground" title={s.priceSource === 'nav' ? 'Coinbase NAV' : 'Underlying market price x multiplier'}>
                    {s.priceSource}
                  </div>
                )}
              </td>
              <td className="py-2 pr-4 text-right tabular-nums">{usd(s.onchainPrice)}</td>
              {showWeights && <td className="py-2 pr-4 text-right tabular-nums">{qty(s.vaultBalance)}</td>}
              {showWeights && <td className="py-2 pr-4 text-right tabular-nums">{usd(s.vaultValueUsd)}</td>}
              <td className="py-2 pr-4 text-right tabular-nums">{Number(s.userBalance) > 0 ? qty(s.userBalance) : '—'}</td>
              <td className="py-2 text-right whitespace-nowrap">
                {onDrip && s.address && (
                  <Button size="sm" variant="ghost" className="mr-2 h-7 px-2" onClick={() => onDrip(s.symbol)} title={`Get 1,000 tUSDC + $250 of ${s.testSymbol}`}>
                    +$250
                  </Button>
                )}
                {s.address && (
                  <a className="inline-flex items-center gap-1 underline" href={explorerUrl(s.address, 'token')} target="_blank" rel="noreferrer">
                    testnet <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                <a className="ml-3 inline-flex items-center gap-1 underline text-muted-foreground" href={`https://basescan.org/token/${s.mainnetAddress}`} target="_blank" rel="noreferrer">
                  {s.symbol} <ExternalLink className="h-3 w-3" />
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
