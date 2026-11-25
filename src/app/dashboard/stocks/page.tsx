'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ExternalLink, RefreshCw, Wallet, Droplets, PieChart } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { BASE_SEPOLIA_CHAIN_ID, explorerUrl } from '@/config/base-sepolia';
import { useInjectedWallet } from '@/hooks/use-injected-wallet';

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

const usd = (n: number | null | undefined, max = 2) =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: max });
const qty = (s: string | number, max = 4) => Number(s).toLocaleString('en-US', { maximumFractionDigits: max });
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function TokenizedStocksPage() {
  const [data, setData] = useState<StocksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const { account, wrongChain, connect: openLogin, ensureBaseSepolia } = useInjectedWallet();
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; msg: string; tx?: string } | null>(null);
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

  const connect = async () => {
    try {
      await openLogin();
    } catch (e) {
      setStatus({ kind: 'err', msg: (e as Error).message });
    }
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

  const basket = useMemo(() => (data?.stocks ?? []).filter((s) => s.inBasket), [data]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.stocks ?? []).filter((s) => {
      if (filter === 'held' && !(Number(s.userBalance) > 0)) return false;
      if (filter === 'nav' && s.priceSource !== 'nav') return false;
      if (filter === 'basket' && !s.inBasket) return false;
      return !q || s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q);
    });
  }, [data, query, filter]);
  const PAGE = 50;
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const pageRows = filtered.slice(page * PAGE, page * PAGE + PAGE);
  useEffect(() => setPage(0), [query, filter]);
  const stalest = Math.max(0, ...basket.map((s) => s.onchainPriceAgeSec ?? 0));
  const canFaucet = Boolean(account && data?.cashToken?.address && !busy);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Tokenized Stocks</h1>
            <Badge variant="outline">Base Sepolia · {BASE_SEPOLIA_CHAIN_ID}</Badge>
          </div>
          <p className="text-muted-foreground mt-1 max-w-2xl">
            Every Coinbase tokenized stock on Base, mirrored as a Base Sepolia test token and priced at live NAV. Get
            test funds here, then invest through an ITF.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
            <Button size="sm" onClick={() => ensureBaseSepolia().catch((e) => setStatus({ kind: 'err', msg: (e as Error).message }))}>
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

          {data.vault ? (
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><PieChart className="h-4 w-4" /> Invest in a basket</CardTitle>
                <CardDescription>
                  You buy stocks here through an ITF. The flagship {data.vault.name} ({data.vault.symbol}) holds the basket below; the
                  community has launched others.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button asChild>
                  <Link href={`/dashboard/etfs/${data.vault.address}`}>
                    Buy or redeem {data.vault.symbol} <ArrowRight className="ml-1 h-4 w-4" />
                  </Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link href="/dashboard/etfs">Explore all ITFs</Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link href="/dashboard/create">Launch your own</Link>
                </Button>
              </CardContent>
            </Card>
          ) : null}
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
                {' · '}onchain prices are {stalest ? `${Math.round(stalest / 60)} min` : '—'} old (the protocol agent syncs them on a schedule)
              </CardDescription>
            </div>
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
              <Input placeholder="Search ticker or company" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search stocks" className="md:max-w-xs" />
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
