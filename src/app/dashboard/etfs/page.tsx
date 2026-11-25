'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { bpsToPct, type EtfSummary } from '@/lib/etf';
import { useInjectedWallet } from '@/hooks/use-injected-wallet';

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: n >= 1000 ? 0 : 2 });
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function EtfDirectoryPage() {
  const { account } = useInjectedWallet();
  const [tab, setTab] = useState<'all' | 'mine'>('all');
  const [etfs, setEtfs] = useState<EtfSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const q = tab === 'mine' && account ? `?manager=${account}` : '';
      const res = await fetch(`/api/etfs${q}`, { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      if (!body.deployed) throw new Error('The ITF factory is not deployed yet.');
      setEtfs(body.etfs);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'mine' && !account) {
      setEtfs([]);
      return;
    }
    load();
     
  }, [tab, account]);

  const mine = tab === 'mine';
  const totalEarned = (etfs ?? []).reduce((a, e) => a + e.managerFeesUsd, 0);
  const totalAum = (etfs ?? []).reduce((a, e) => a + e.totalValueUsd, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">ITFs</h1>
          <p className="mt-1 text-muted-foreground">Stock baskets built and managed by the community on Base Sepolia.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`mr-1 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          <Button size="sm" asChild>
            <Link href="/dashboard/create">
              <Plus className="mr-1 h-4 w-4" /> Launch an ITF
            </Link>
          </Button>
        </div>
      </div>

      <div role="tablist" className="inline-flex rounded-md border p-1 text-sm">
        {(['all', 'mine'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded px-3 py-1 ${tab === t ? 'bg-muted font-medium' : 'text-muted-foreground'}`}
          >
            {t === 'all' ? 'All ITFs' : 'Managed by you'}
          </button>
        ))}
      </div>

      {mine && account && etfs && etfs.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="ITFs you run" value={String(etfs.length)} />
          <Stat label="Assets under management" value={usd(totalAum)} />
          <Stat label="Fees earned to date" value={usd(totalEarned)} />
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      {mine && !account ? (
        <EmptyState title="Connect a wallet" body="Connect the wallet you launched ITFs with to see what they've earned." />
      ) : etfs && etfs.length === 0 ? (
        <EmptyState
          title={mine ? "You haven't launched an ITF yet" : 'No ITFs yet'}
          body="Pick a basket of stocks, set your fees, and earn a share of the fund for managing it."
          cta
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(etfs ?? []).map((e) => (
            <Link key={e.address} href={`/dashboard/etfs/${e.address}`} className="group">
              <Card className="h-full transition-colors group-hover:border-primary/50">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="truncate text-lg">{e.name}</CardTitle>
                      <CardDescription className="font-mono">{e.symbol}</CardDescription>
                    </div>
                    {account && e.manager.toLowerCase() === account && <Badge>Manager</Badge>}
                  </div>
                  {e.description && <p className="line-clamp-2 text-sm text-muted-foreground">{e.description}</p>}
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <Kv k="AUM" v={usd(e.totalValueUsd)} />
                    <Kv k="NAV / share" v={usd(e.navPerShare)} />
                    <Kv k="Mgmt fee" v={`${bpsToPct(e.fees.managementFeeBps)}/yr`} />
                    <Kv k="Entry · exit" v={`${bpsToPct(e.fees.entryFeeBps)} · ${bpsToPct(e.fees.exitFeeBps)}`} />
                    <Kv k="Stocks" v={String(e.assetCount)} />
                    <Kv k="Manager earned" v={usd(e.managerFeesUsd)} />
                  </dl>
                  <p className="mt-3 text-xs text-muted-foreground">Managed by {short(e.manager)}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

function EmptyState({ title, body, cta }: { title: string; body: string; cta?: boolean }) {
  return (
    <Card className="py-10 text-center">
      <CardContent className="space-y-3">
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">{body}</p>
        {cta && (
          <Button asChild>
            <Link href="/dashboard/create">Launch an ITF</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
