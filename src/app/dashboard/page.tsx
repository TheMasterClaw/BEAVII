'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, RefreshCw, Wallet } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BarList, StatCard, short, usd } from '@/components/dashboard/bar-list';
import { NETWORK } from '@/config/network';
import { bpsToPct, type EtfPosition, type EtfSummary } from '@/lib/etf';
import { txErrorMessage, useInjectedWallet } from '@/hooks/use-injected-wallet';

/** Overview: live protocol totals, the connected wallet's positions, and the largest ETFs, all read onchain. */
export default function OverviewPage() {
  const { account, connect } = useInjectedWallet();
  const [etfs, setEtfs] = useState<EtfSummary[] | null>(null);
  const [deployed, setDeployed] = useState(true);
  const [positions, setPositions] = useState<EtfPosition[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [etfRes, posRes] = await Promise.all([
        fetch('/api/etfs', { cache: 'no-store' }),
        account ? fetch(`/api/portfolio?account=${account}`, { cache: 'no-store' }) : Promise.resolve(null),
      ]);
      const etfBody = await etfRes.json();
      if (!etfRes.ok) throw new Error(etfBody.error);
      setDeployed(Boolean(etfBody.deployed));
      setEtfs(etfBody.etfs ?? []);
      if (posRes) {
        const posBody = await posRes.json();
        if (!posRes.ok) throw new Error(posBody.error);
        setPositions(posBody.positions ?? []);
      } else {
        setPositions(null);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const list = etfs ?? [];
  const aum = list.reduce((a, e) => a + e.totalValueUsd, 0);
  const managerFees = list.reduce((a, e) => a + e.managerFeesUsd, 0);
  const myValue = (positions ?? []).reduce((a, p) => a + p.valueUsd, 0);
  const largest = [...list].sort((x, y) => y.totalValueUsd - x.totalValueUsd).slice(0, 8);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold tracking-tight">Overview</h1>
            <Badge variant="outline">{NETWORK.name}</Badge>
          </div>
          <p className="mt-1 text-muted-foreground">Live totals for every tokenized-stock ETF on the protocol.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`mr-1 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          <Button size="sm" asChild>
            <Link href="/dashboard/create">
              <Plus className="mr-1 h-4 w-4" /> Launch an ETF
            </Link>
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
      {!deployed && (
        <Card>
          <CardHeader>
            <CardTitle>Not deployed yet</CardTitle>
            <CardDescription>The ETF factory is not deployed on {NETWORK.name} yet.</CardDescription>
          </CardHeader>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Assets under management" value={etfs ? usd(aum) : '—'} sub="across all ETFs" />
        <StatCard label="ETFs" value={etfs ? String(list.length) : '—'} />
        <StatCard label="Paid to managers" value={etfs ? usd(managerFees) : '—'} sub="value when paid" />
        <StatCard
          label="Your holdings"
          value={account ? (positions ? usd(myValue) : '—') : '—'}
          sub={account ? `${positions?.length ?? 0} ETFs` : 'Connect a wallet'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your positions</CardTitle>
            <CardDescription>ETF shares held by this wallet, valued at the live NAV.</CardDescription>
          </CardHeader>
          <CardContent>
            {!account ? (
              <Button onClick={() => connect().catch((e) => setError(txErrorMessage(e)))}>
                <Wallet className="mr-1 h-4 w-4" /> Connect wallet
              </Button>
            ) : positions && positions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                This wallet holds no ETF shares yet. <Link className="underline" href="/dashboard/etfs">Browse ETFs</Link>.
              </p>
            ) : (
              <ul className="divide-y text-sm">
                {(positions ?? []).map((p) => (
                  <li key={p.etf.address} className="flex items-center justify-between gap-3 py-2">
                    <Link href={`/dashboard/etfs/${p.etf.address}`} className="min-w-0 hover:underline">
                      <span className="font-medium">{p.etf.name}</span>{' '}
                      <span className="font-mono text-xs text-muted-foreground">{p.etf.symbol}</span>
                      {p.isManager && <Badge className="ml-2">Manager</Badge>}
                    </Link>
                    <span className="shrink-0 text-right tabular-nums">
                      {usd(p.valueUsd)}
                      <span className="block text-xs text-muted-foreground">
                        {p.shares.toLocaleString('en-US', { maximumFractionDigits: 4 })} shares
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Largest ETFs by AUM</CardTitle>
            <CardDescription>Top {largest.length || ''} of {list.length} ETFs.</CardDescription>
          </CardHeader>
          <CardContent>
            <BarList
              label="Largest ETFs by assets under management"
              emptyText="No ETFs have assets yet."
              rows={largest.map((e) => ({
                key: e.address,
                label: e.name,
                sublabel: `${e.symbol} · ${bpsToPct(e.fees.managementFeeBps)}/yr · by ${short(e.manager)}`,
                value: e.totalValueUsd,
                display: usd(e.totalValueUsd),
                href: `/dashboard/etfs/${e.address}`,
              }))}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
