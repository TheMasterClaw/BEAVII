'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, RefreshCw, Wallet } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { usd } from '@/components/dashboard/bar-list';
import { CASH_TOKEN, NETWORK, explorerUrl } from '@/config/network';
import type { EtfActivity } from '@/lib/etf';
import { txErrorMessage, useInjectedWallet } from '@/hooks/use-injected-wallet';

const KIND_LABEL: Record<EtfActivity['kind'], string> = { deposit: 'Buy', redeem: 'Redeem', created: 'Launched ETF' };

/** The connected wallet's ETF activity, read from onchain event logs. */
export default function TransactionsPage() {
  const { account, connect } = useInjectedWallet();
  const [rows, setRows] = useState<EtfActivity[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!account) return setRows(null);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/activity?account=${account}`, { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setRows(body.activity ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Transactions</h1>
          <p className="mt-1 text-muted-foreground">Your ETF buys, redemptions and launches on {NETWORK.name}, from onchain events.</p>
        </div>
        <div className="flex gap-2">
          {account && (
            <>
              <Button variant="outline" size="sm" onClick={load} disabled={loading}>
                <RefreshCw className={`mr-1 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href={explorerUrl(account)} target="_blank" rel="noopener noreferrer">
                  All wallet activity <ExternalLink className="ml-1 h-3 w-3" />
                </a>
              </Button>
            </>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">ETF activity</CardTitle>
          <CardDescription>{account ? `Most recent first, up to 100 entries.` : 'Connect a wallet to see its activity.'}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {!account ? (
            <Button onClick={() => connect().catch((e) => setError(txErrorMessage(e)))}>
              <Wallet className="mr-1 h-4 w-4" /> Connect wallet
            </Button>
          ) : rows === null ? (
            <p className="text-sm text-muted-foreground">Reading event logs…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No ETF activity for this wallet yet. <Link className="underline" href="/dashboard/etfs">Browse ETFs</Link>.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-4 font-medium">When</th>
                  <th className="py-2 pr-4 font-medium">Action</th>
                  <th className="py-2 pr-4 font-medium">ETF</th>
                  <th className="py-2 pr-4 text-right font-medium">Shares</th>
                  <th className="py-2 pr-4 text-right font-medium">Value</th>
                  <th className="py-2 text-right font-medium">Transaction</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.txHash}-${r.kind}-${r.etf}`} className="border-b last:border-0">
                    <td className="py-2 pr-4 whitespace-nowrap tabular-nums">
                      {r.timestamp ? new Date(r.timestamp * 1000).toLocaleString() : `block ${r.blockNumber}`}
                    </td>
                    <td className="py-2 pr-4">
                      {KIND_LABEL[r.kind]}
                      {r.inKind && (
                        <Badge variant="outline" className="ml-2">
                          in kind
                        </Badge>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      <Link href={`/dashboard/etfs/${r.etf}`} className="font-mono hover:underline">
                        {r.etfSymbol || r.etf.slice(0, 10)}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {r.shares == null ? '—' : r.shares.toLocaleString('en-US', { maximumFractionDigits: 4 })}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {r.valueUsd == null ? '—' : r.kind === 'redeem' ? `${r.valueUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${CASH_TOKEN.symbol}` : usd(r.valueUsd)}
                    </td>
                    <td className="py-2 text-right">
                      <a className="inline-flex items-center gap-1 font-mono text-xs underline" href={explorerUrl(r.txHash, 'tx')} target="_blank" rel="noopener noreferrer">
                        {r.txHash.slice(0, 10)}… <ExternalLink className="h-3 w-3" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
