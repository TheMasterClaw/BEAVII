'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Droplets, ExternalLink, Plus, RefreshCw, Wallet } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BASE_SEPOLIA, explorerUrl } from '@/config/base-sepolia';
import { bpsToPct, type Portfolio } from '@/lib/etf';
import { txErrorMessage, useInjectedWallet } from '@/hooks/use-injected-wallet';
import { PortfolioCharts } from '@/components/charts/portfolio-charts';

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: n >= 1000 ? 0 : 2 });
const qty = (n: number, max = 4) => n.toLocaleString('en-US', { maximumFractionDigits: max });

type Status = { kind: 'ok' | 'err'; msg: string; tx?: string } | null;

export default function PortfolioPage() {
  const { account, connect } = useInjectedWallet();
  const [data, setData] = useState<Portfolio | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const load = useCallback(async () => {
    if (!account) return setData(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/portfolio?account=${account}`, { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setData(body);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => {
    load();
  }, [load]);

  const faucet = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch('/api/stocks/faucet', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address: account }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setStatus({ kind: 'ok', msg: '1,000 tUSDC is on its way to your wallet.', tx: body.txHashes?.[0] });
      await load();
    } catch (e) {
      setStatus({ kind: 'err', msg: `Faucet failed: ${txErrorMessage(e)}` });
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Portfolio</h1>
        <p className="mt-1 text-muted-foreground">Your ITF holdings and the ITFs you manage on {BASE_SEPOLIA.name}.</p>
      </div>
      {account && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`mr-1 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={explorerUrl(account)} target="_blank" rel="noreferrer">
              Activity on Basescan <ExternalLink className="ml-1 h-3 w-3" />
            </a>
          </Button>
        </div>
      )}
    </div>
  );

  if (!account) {
    return (
      <div className="space-y-6">
        {header}
        <Card className="py-6">
          <CardHeader>
            <CardTitle>Log in to see your portfolio</CardTitle>
            <CardDescription>
              Use any wallet, or sign in with email or a social account. You can browse ITFs without logging in.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button onClick={() => connect().catch((e) => setError(txErrorMessage(e)))}>
              <Wallet className="mr-1 h-4 w-4" /> Log in
            </Button>
            <Button variant="outline" asChild>
              <Link href="/dashboard/etfs">Explore ITFs</Link>
            </Button>
          </CardContent>
        </Card>
        <HowItWorks />
      </div>
    );
  }

  const invested = (data?.positions ?? []).reduce((a, p) => a + p.valueUsd, 0);
  const earned = (data?.managed ?? []).reduce((a, e) => a + e.managerFeesUsd, 0);
  const isNew = data && data.positions.length === 0 && data.managed.length === 0;

  return (
    <div className="space-y-6">
      {header}

      {status && (
        <div role="status" className={`rounded-md border px-4 py-3 text-sm ${status.kind === 'ok' ? 'border-green-500/40 bg-green-500/10' : 'border-red-500/40 bg-red-500/10'}`}>
          {status.msg}
          {status.tx && (
            <a className="ml-2 underline" href={explorerUrl(status.tx, 'tx')} target="_blank" rel="noreferrer">
              View transaction
            </a>
          )}
        </div>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Invested in ITFs" value={data ? usd(invested) : '…'} sub={data ? `${data.positions.length} ITF${data.positions.length === 1 ? '' : 's'}` : undefined} />
        <Stat label="Cash" value={data ? `${qty(data.cash, 2)} tUSDC` : '…'} />
        <Stat label="ITFs you manage" value={data ? String(data.managed.length) : '…'} />
        <Stat label="Manager fees earned" value={data ? usd(earned) : '…'} sub="at value when paid" />
      </div>

      {data && !isNew && <PortfolioCharts data={data} />}

      {isNew && (
        <Card>
          <CardHeader>
            <CardTitle>Get started</CardTitle>
            <CardDescription>Three steps, all on testnet, no real money.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <Step n={1} title="Get test funds" done={data.cash > 0}>
              <p>
                Gas needs Base Sepolia ETH from the{' '}
                <a className="underline" href={BASE_SEPOLIA.faucetUrl} target="_blank" rel="noreferrer">CDP faucet</a>. Test cash is free.
              </p>
              <Button size="sm" className="mt-2" disabled={busy} onClick={faucet}>
                <Droplets className="mr-1 h-4 w-4" /> {busy ? 'Minting…' : 'Get 1,000 tUSDC'}
              </Button>
            </Step>
            <Step n={2} title="Buy an ITF">
              <p>Pick a stock basket. Your tUSDC buys every stock in it at NAV.</p>
              <Button size="sm" variant="outline" className="mt-2" asChild>
                <Link href="/dashboard/etfs">Explore ITFs</Link>
              </Button>
            </Step>
            <Step n={3} title="Or launch your own">
              <p>Choose up to 20 stocks, set fees, and earn a share of the fund for managing it.</p>
              <Button size="sm" variant="outline" className="mt-2" asChild>
                <Link href="/dashboard/create">Launch an ITF</Link>
              </Button>
            </Step>
          </CardContent>
        </Card>
      )}

      {data && data.positions.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">Your holdings</CardTitle>
              <CardDescription>Valued at each ITF&apos;s current NAV.</CardDescription>
            </div>
            <Button variant="outline" size="sm" disabled={busy} onClick={faucet}>
              <Droplets className="mr-1 h-4 w-4" /> {busy ? 'Minting…' : 'Get tUSDC'}
            </Button>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-4 font-medium">ITF</th>
                  <th className="py-2 pr-4 text-right font-medium">Shares</th>
                  <th className="py-2 pr-4 text-right font-medium">NAV / share</th>
                  <th className="py-2 pr-4 text-right font-medium">Value</th>
                  <th className="py-2 text-right font-medium" />
                </tr>
              </thead>
              <tbody>
                {data.positions.map((p) => (
                  <tr key={p.etf.address} className="border-b last:border-0">
                    <td className="py-2 pr-4">
                      <div className="font-medium">{p.etf.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">{p.etf.symbol}</div>
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">{qty(p.shares)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{usd(p.etf.navPerShare)}</td>
                    <td className="py-2 pr-4 text-right font-medium tabular-nums">{usd(p.valueUsd)}</td>
                    <td className="py-2 text-right">
                      <Link className="inline-flex items-center gap-1 underline" href={`/dashboard/etfs/${p.etf.address}`}>
                        Buy / redeem <ArrowRight className="h-3 w-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {data && data.managed.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">ITFs you manage</CardTitle>
              <CardDescription>Open one to rebalance, change fees, or collect what has accrued.</CardDescription>
            </div>
            <Button size="sm" asChild>
              <Link href="/dashboard/create">
                <Plus className="mr-1 h-4 w-4" /> Launch another
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {data.managed.map((e) => (
              <Link key={e.address} href={`/dashboard/etfs/${e.address}`} className="group rounded-md border p-4 transition-colors hover:border-primary/50">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{e.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">{e.symbol}</div>
                  </div>
                  <Badge variant="outline">{bpsToPct(e.fees.managementFeeBps)}/yr</Badge>
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                  <Kv k="AUM" v={usd(e.totalValueUsd)} />
                  <Kv k="Stocks" v={String(e.assetCount)} />
                  <Kv k="You earned" v={usd(e.managerFeesUsd)} />
                </dl>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function HowItWorks() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {[
        ['Stock baskets on Base', 'Each ITF is an ERC-20 share in a basket of tokenized stocks, priced at live NAV.'],
        ['Buy and redeem at NAV', 'Pay tUSDC to buy; redeem for tUSDC or take the stocks themselves, even if the ITF is paused.'],
        ['Anyone can manage', 'Launch an ITF, set its weights and fees, and earn new shares as the fund grows.'],
      ].map(([t, b]) => (
        <Card key={t}>
          <CardHeader>
            <CardTitle className="text-base">{t}</CardTitle>
            <CardDescription>{b}</CardDescription>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <div className="rounded-md border p-4 text-sm text-muted-foreground">
      <div className="mb-1 flex items-center gap-2 font-medium text-foreground">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs text-primary">{done ? '✓' : n}</span>
        {title}
      </div>
      {children}
    </div>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{k}</dt>
      <dd className="font-medium tabular-nums">{v}</dd>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}
