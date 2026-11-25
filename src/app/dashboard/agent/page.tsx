'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BASE_SEPOLIA, explorerUrl } from '@/config/base-sepolia';

interface AgentStatus {
  configured: boolean;
  address?: string;
  balanceEth?: number;
  transactions?: number;
  authorizedOnExchange?: boolean | null;
  authorizedOnFlagship?: boolean | null;
  maxPriceAgeSec?: number | null;
  flagship?: { address: string; symbol: string; lastRebalance: number; stalestPriceSec: number | null } | null;
  error?: string;
}

const ago = (sec: number | null | undefined) => {
  if (sec == null) return '—';
  if (sec < 3600) return `${Math.round(sec / 60)} min ago`;
  if (sec < 172_800) return `${Math.round(sec / 3600)} h ago`;
  return `${Math.round(sec / 86_400)} days ago`;
};

export default function ProtocolAgentPage() {
  const [s, setS] = useState<AgentStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/flow/agent', { cache: 'no-store' });
      setS(await res.json());
    } catch (e) {
      setS({ configured: true, error: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const stale = s?.flagship?.stalestPriceSec != null && s.maxPriceAgeSec != null && s.flagship.stalestPriceSec > s.maxPriceAgeSec;
  const lowGas = s?.balanceEth != null && s.balanceEth < 0.002;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Protocol Agent</h1>
          <p className="mt-1 max-w-2xl text-muted-foreground">
            The server key that pushes live NAV prices onchain and rebalances the flagship ITF on a weekday schedule. Your own
            AI agents live on <Link className="underline" href="/dashboard/agents">Your Agents</Link>.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`mr-1 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      {s && !s.configured && (
        <Card>
          <CardHeader>
            <CardTitle>No agent configured</CardTitle>
            <CardDescription>Run <code>npm run setup:agent</code> to create and authorize the protocol agent.</CardDescription>
          </CardHeader>
        </Card>
      )}
      {s?.error && <p className="text-sm text-red-500">{s.error}</p>}

      {s?.address && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Agent wallet</CardTitle>
              <CardDescription>
                <a className="inline-flex items-center gap-1 font-mono underline" href={explorerUrl(s.address)} target="_blank" rel="noreferrer">
                  {s.address} <ExternalLink className="h-3 w-3" />
                </a>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2 text-sm">
                <Row k="Gas balance" v={s.balanceEth != null ? `${s.balanceEth.toFixed(4)} ETH` : '—'} warn={lowGas ? `Low: top up from the CDP faucet` : undefined} />
                <Row k="Transactions sent" v={s.transactions != null ? String(s.transactions) : '—'} />
                <Row k="Can set prices (exchange)" v={<Flag v={s.authorizedOnExchange} />} />
                <Row k="Can rebalance the flagship" v={<Flag v={s.authorizedOnFlagship} />} />
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Prices and rebalancing</CardTitle>
              <CardDescription>
                Deposits, cash redemptions and rebalances revert when a price is older than{' '}
                {s.maxPriceAgeSec != null ? `${Math.round(s.maxPriceAgeSec / 86_400)} days` : 'the exchange limit'}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2 text-sm">
                <Row
                  k={`Oldest ${s.flagship?.symbol ?? 'flagship'} price`}
                  v={ago(s.flagship?.stalestPriceSec)}
                  warn={stale ? 'Stale: trading is blocked until the next sync' : undefined}
                />
                <Row k="Last flagship rebalance" v={s.flagship?.lastRebalance ? new Date(s.flagship.lastRebalance * 1000).toLocaleString() : 'never'} />
              </dl>
              {s.flagship && (
                <Button variant="outline" size="sm" className="mt-4" asChild>
                  <Link href={`/dashboard/etfs/${s.flagship.address}`}>Open {s.flagship.symbol}</Link>
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Every value is read live from {BASE_SEPOLIA.name}. For the agent&apos;s full history, open its address on Basescan.
      </p>
    </div>
  );
}

function Row({ k, v, warn }: { k: string; v: React.ReactNode; warn?: string }) {
  return (
    <div>
      <div className="flex justify-between gap-4">
        <dt className="text-muted-foreground">{k}</dt>
        <dd className="text-right font-medium tabular-nums">{v}</dd>
      </div>
      {warn && <p className="text-right text-xs text-amber-600">{warn}</p>}
    </div>
  );
}

function Flag({ v }: { v: boolean | null | undefined }) {
  if (v == null) return <span>—</span>;
  return <Badge variant={v ? 'secondary' : 'destructive'}>{v ? 'Yes' : 'No'}</Badge>;
}
