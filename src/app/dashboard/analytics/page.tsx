'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BarList, StatCard, usd } from '@/components/dashboard/bar-list';
import { NETWORK } from '@/config/network';
import { bpsToPct, type ProtocolAnalytics } from '@/lib/etf';

/** Analytics: live AUM, combined stock exposure and fees across every ETF, read onchain at request time. */
export default function AnalyticsPage() {
  const [data, setData] = useState<(ProtocolAnalytics & { deployed: boolean }) | { deployed: false } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/analytics', { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setData(body);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const a = data && data.deployed ? (data as ProtocolAnalytics) : null;
  const etfsByAum = a ? [...a.etfs].sort((x, y) => y.totalValueUsd - x.totalValueUsd) : [];
  const exposureTotal = a ? a.exposure.reduce((s, e) => s + e.valueUsd, 0) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
          <p className="mt-1 text-muted-foreground">
            Current state of every ETF on {NETWORK.name}
            {a ? `, read ${new Date(a.generatedAt).toLocaleTimeString()}` : ''}.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`mr-1 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
      {data && !data.deployed && <p className="text-sm text-muted-foreground">The ETF factory is not deployed on {NETWORK.name} yet.</p>}
      {!data && !error && <p className="text-sm text-muted-foreground">Reading every ETF onchain…</p>}

      {a && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Assets under management" value={usd(a.totalValueUsd)} />
            <StatCard label="ETFs" value={String(a.etfs.length)} />
            <StatCard label="Paid to managers" value={usd(a.managerFeesUsd)} sub="value when paid" />
            <StatCard label="Paid to protocol" value={usd(a.protocolFeesUsd)} sub="value when paid" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Assets under management by ETF</CardTitle>
                <CardDescription>USD value of each ETF&apos;s holdings at current oracle prices.</CardDescription>
              </CardHeader>
              <CardContent>
                <BarList
                  label="Assets under management by ETF"
                  emptyText="No ETFs hold assets yet."
                  rows={etfsByAum.map((e) => ({
                    key: e.address,
                    label: e.name,
                    sublabel: e.symbol,
                    value: e.totalValueUsd,
                    display: usd(e.totalValueUsd),
                    href: `/dashboard/etfs/${e.address}`,
                  }))}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Combined stock exposure</CardTitle>
                <CardDescription>
                  What all ETFs hold together, top {Math.min(20, a.exposure.length)} of {a.exposure.length} stocks.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <BarList
                  label="Combined stock exposure across ETFs"
                  emptyText="No stock holdings yet."
                  rows={a.exposure.slice(0, 20).map((s) => ({
                    key: s.token,
                    label: s.symbol,
                    sublabel: `${s.name} · ${s.etfCount} ETF${s.etfCount === 1 ? '' : 's'}`,
                    value: s.valueUsd,
                    display: `${usd(s.valueUsd)} · ${exposureTotal > 0 ? ((s.valueUsd / exposureTotal) * 100).toFixed(1) : '0.0'}%`,
                    iconUrl: s.iconUrl,
                  }))}
                />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">All ETFs</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-2 pr-4 font-medium">ETF</th>
                    <th className="py-2 pr-4 text-right font-medium">AUM</th>
                    <th className="py-2 pr-4 text-right font-medium">NAV / share</th>
                    <th className="py-2 pr-4 text-right font-medium">Mgmt fee</th>
                    <th className="py-2 pr-4 text-right font-medium">Stocks</th>
                    <th className="py-2 pr-4 text-right font-medium">Manager earned</th>
                    <th className="py-2 text-right font-medium">Protocol earned</th>
                  </tr>
                </thead>
                <tbody>
                  {etfsByAum.map((e) => (
                    <tr key={e.address} className="border-b last:border-0">
                      <td className="py-2 pr-4">
                        <Link href={`/dashboard/etfs/${e.address}`} className="font-medium hover:underline">
                          {e.name}
                        </Link>{' '}
                        <span className="font-mono text-xs text-muted-foreground">{e.symbol}</span>
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">{usd(e.totalValueUsd)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{usd(e.navPerShare, 4)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{bpsToPct(e.fees.managementFeeBps)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{e.assetCount}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{usd(e.managerFeesUsd)}</td>
                      <td className="py-2 text-right tabular-nums">{usd(e.protocolFeesUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
