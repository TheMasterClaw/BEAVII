'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ethers } from 'ethers';
import { ArrowDownToLine, ArrowUpFromLine, Coins, ExternalLink, RefreshCw, Scale, Wallet } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { CASH_TOKEN, STOCKS, explorerUrl } from '@/config/base-sepolia';
import { B20_ABI, STOCK_VAULT_ABI } from '@/lib/stock-vault';
import { FEE_LIMITS, bpsToPct, type EtfDetail } from '@/lib/etf';
import { txErrorMessage, useInjectedWallet } from '@/hooks/use-injected-wallet';
import { useListedStocks } from '@/hooks/use-listed-stocks';

const usd = (n: number | null | undefined, max = 2) =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: max });
const qty = (n: number | string, max = 4) => Number(n).toLocaleString('en-US', { maximumFractionDigits: max });
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

type Status = { kind: 'ok' | 'err'; msg: string; tx?: string } | null;

export default function EtfDetailPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params);
  const justCreated = useSearchParams().get('created') === '1';
  const { account, wrongChain, connect, getSigner } = useInjectedWallet();
  const [etf, setEtf] = useState<EtfDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(
    justCreated ? { kind: 'ok', msg: 'Your ITF is live. Share this page so people can invest, then buy in yourself to seed it.' } : null,
  );
  const [depositAmt, setDepositAmt] = useState('100');
  const [redeemAmt, setRedeemAmt] = useState('');
  const [inKind, setInKind] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/etfs/${address}${account ? `?account=${account}` : ''}`, { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setEtf(body);
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [address, account]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const run = async (label: string, fn: () => Promise<string | undefined>) => {
    setBusy(label);
    setStatus(null);
    try {
      const tx = await fn();
      setStatus({ kind: 'ok', msg: `${label} confirmed`, tx });
      await load();
    } catch (e) {
      setStatus({ kind: 'err', msg: `${label} failed: ${txErrorMessage(e)}` });
    } finally {
      setBusy(null);
    }
  };

  const vaultWith = async () => new ethers.Contract(address, STOCK_VAULT_ABI, await getSigner());
  const send = async (fn: (v: ethers.Contract) => Promise<ethers.ContractTransactionResponse>) => {
    const tx = await fn(await vaultWith());
    await tx.wait();
    return tx.hash;
  };

  const faucet = () =>
    run('Faucet', async () => {
      const res = await fetch('/api/stocks/faucet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: account }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      return body.txHashes?.[0];
    });

  const deposit = () =>
    run('Buy', async () => {
      const signer = await getSigner();
      const amount = ethers.parseUnits(depositAmt, CASH_TOKEN.decimals);
      const cash = new ethers.Contract(CASH_TOKEN.address, B20_ABI, signer);
      if ((await cash.allowance(account, address)) < amount) await (await cash.approve(address, amount)).wait();
      return send((v) => v.deposit(CASH_TOKEN.address, amount));
    });

  const redeem = () =>
    run('Redeem', async () => {
      const kind = inKind || Boolean(etf?.paused);
      const hash = await send((v) => v.withdraw(ethers.parseEther(redeemAmt), kind ? ethers.ZeroAddress : CASH_TOKEN.address, 0));
      setRedeemAmt('');
      return hash;
    });

  if (loadError && !etf) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>ITF not found</CardTitle>
          <CardDescription>{loadError}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" asChild>
            <Link href="/dashboard/etfs">Back to ITFs</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (!etf) return <p className="text-sm text-muted-foreground">Loading ITF…</p>;

  const me = etf.account;
  const canTx = Boolean(account && !busy);
  const stalest = Math.max(0, ...etf.holdings.map((h) => h.priceAgeSec ?? 0));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <Link href="/dashboard/etfs" className="text-sm text-muted-foreground hover:underline">
            ← All ITFs
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="break-words text-2xl font-bold tracking-tight sm:text-3xl">{etf.name}</h1>
            <Badge variant="outline" className="font-mono">{etf.symbol}</Badge>
            {me?.isManager && <Badge>You manage this</Badge>}
            {etf.paused && <Badge variant="destructive">Paused</Badge>}
          </div>
          {etf.description && <p className="mt-1 max-w-2xl text-muted-foreground">{etf.description}</p>}
          <p className="mt-1 text-xs text-muted-foreground">
            Managed by{' '}
            <a className="font-mono underline" href={explorerUrl(etf.manager)} target="_blank" rel="noreferrer">{short(etf.manager)}</a>
            {' · '}
            <a className="inline-flex items-center gap-1 underline" href={explorerUrl(etf.address)} target="_blank" rel="noreferrer">
              contract <ExternalLink className="h-3 w-3" />
            </a>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="mr-1 h-4 w-4" /> Refresh
          </Button>
          {!account ? (
            <Button size="sm" onClick={() => connect().catch((e) => setStatus({ kind: 'err', msg: txErrorMessage(e) }))}>
              <Wallet className="mr-1 h-4 w-4" /> Connect wallet
            </Button>
          ) : (
            <Badge variant={wrongChain ? 'destructive' : 'secondary'} className="font-mono">
              {wrongChain ? 'Wrong network' : short(account)}
            </Badge>
          )}
        </div>
      </div>

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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Assets under management" value={usd(etf.totalValueUsd)} />
        <Stat label={`NAV per ${etf.symbol}`} value={usd(etf.navPerShare, 4)} />
        <Stat
          label="Fees"
          value={`${bpsToPct(etf.fees.managementFeeBps)}/yr`}
          sub={`entry ${bpsToPct(etf.fees.entryFeeBps)} · exit ${bpsToPct(etf.fees.exitFeeBps)}`}
        />
        <Stat label="Your position" value={me ? usd(me.valueUsd) : '—'} sub={me ? `${qty(me.shares)} shares · ${qty(me.cash, 2)} tUSDC` : 'Connect a wallet'} />
      </div>

      {etf.pendingFees && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          Fee change scheduled for {new Date(etf.pendingFeesEta * 1000).toLocaleString()}: management {bpsToPct(etf.pendingFees.managementFeeBps)}/yr, entry{' '}
          {bpsToPct(etf.pendingFees.entryFeeBps)}, exit {bpsToPct(etf.pendingFees.exitFeeBps)}. You can redeem before then at the current fees.
        </div>
      )}

      {me?.isManager && <ManagerPanel etf={etf} busy={busy} run={run} send={send} />}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Coins className="h-4 w-4" /> Test funds</CardTitle>
            <CardDescription>Gas needs Base Sepolia ETH. Test cash is free.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" variant="outline" disabled={!canTx} onClick={faucet}>
              {busy === 'Faucet' ? 'Minting…' : 'Get 1,000 tUSDC'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><ArrowDownToLine className="h-4 w-4" /> Buy {etf.symbol}</CardTitle>
            <CardDescription>
              Pay tUSDC; the ITF buys each stock at NAV by weight.
              {etf.fees.entryFeeBps > 0 && ` ${bpsToPct(etf.fees.entryFeeBps)} entry fee.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex gap-2">
              <Input inputMode="decimal" aria-label="tUSDC amount" value={depositAmt} onChange={(e) => setDepositAmt(e.target.value)} />
              <span className="self-center text-sm text-muted-foreground">tUSDC</span>
            </div>
            <Button className="w-full" disabled={!canTx || etf.paused || !(Number(depositAmt) > 0)} onClick={deposit}>
              {busy === 'Buy' ? 'Confirm in wallet…' : 'Approve & buy'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><ArrowUpFromLine className="h-4 w-4" /> Redeem</CardTitle>
            <CardDescription>
              Get tUSDC at NAV, or the stocks themselves (always available, even when paused).
              {etf.fees.exitFeeBps > 0 && ` ${bpsToPct(etf.fees.exitFeeBps)} exit fee.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex gap-2">
              <Input inputMode="decimal" placeholder="Shares" aria-label="Shares to redeem" value={redeemAmt} onChange={(e) => setRedeemAmt(e.target.value)} />
              <Button variant="outline" size="sm" className="self-center" disabled={!me} onClick={() => setRedeemAmt(me ? ethers.formatEther(me.sharesWei) : '')}>
                Max
              </Button>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={inKind || etf.paused} disabled={etf.paused} onChange={(e) => setInKind(e.target.checked)} />
              Redeem in kind (receive the stock tokens)
            </label>
            <Button className="w-full" disabled={!canTx || !(Number(redeemAmt) > 0)} onClick={redeem}>
              {busy === 'Redeem' ? 'Confirm in wallet…' : 'Redeem'}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Holdings</CardTitle>
            <CardDescription>
              Prices are {stalest ? `${Math.round(stalest / 60)} min` : '—'} old · last rebalance{' '}
              {etf.lastRebalance ? new Date(etf.lastRebalance * 1000).toLocaleString() : 'never'}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 pr-4 font-medium">Stock</th>
                <th className="py-2 pr-4 text-right font-medium">Target</th>
                <th className="py-2 pr-4 text-right font-medium">Actual</th>
                <th className="py-2 pr-4 text-right font-medium">Price</th>
                <th className="py-2 pr-4 text-right font-medium">Held</th>
                <th className="py-2 text-right font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
              {etf.holdings.map((h) => (
                <tr key={h.token} className="border-b last:border-0">
                  <td className="py-2 pr-4">
                    <div className="flex items-center gap-2">
                      {h.iconUrl && <img src={h.iconUrl} alt="" width={24} height={24} className="rounded-full" />}
                      <div>
                        <div className="font-medium">{h.symbol}</div>
                        <div className="text-xs text-muted-foreground">{h.name}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">{bpsToPct(h.targetWeightBps)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{etf.totalValueUsd > 0 ? bpsToPct(h.actualWeightBps) : '—'}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{usd(h.priceUsd)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{qty(h.balance)}</td>
                  <td className="py-2 text-right tabular-nums">{usd(h.valueUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Testnet only. Test tokens have no value and are not offers of any security. Managers are community members, not
        BEAVII. The protocol keeps {bpsToPct(etf.protocolFeeBps, 0)} of fees.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- manager

interface ManagerPanelProps {
  etf: EtfDetail;
  busy: string | null;
  run: (label: string, fn: () => Promise<string | undefined>) => Promise<void>;
  send: (fn: (v: ethers.Contract) => Promise<ethers.ContractTransactionResponse>) => Promise<string>;
}

function ManagerPanel({ etf, busy, run, send }: ManagerPanelProps) {
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [newStock, setNewStock] = useState('');
  const [mgmt, setMgmt] = useState('');
  const [entry, setEntry] = useState('');
  const [exit, setExit] = useState('');

  useEffect(() => {
    setWeights(Object.fromEntries(etf.holdings.map((h) => [h.token, (h.targetWeightBps / 100).toFixed(2)])));
    setMgmt((etf.fees.managementFeeBps / 100).toFixed(2));
    setEntry((etf.fees.entryFeeBps / 100).toFixed(2));
    setExit((etf.fees.exitFeeBps / 100).toFixed(2));
    // reset editors only when the onchain config changes
     
  }, [etf.address, JSON.stringify(etf.holdings.map((h) => [h.token, h.targetWeightBps])), JSON.stringify(etf.fees)]);

  const bps = (s: string) => Math.round(Number(s || 0) * 100);
  const totalBps = Object.values(weights).reduce((a, w) => a + bps(w), 0);
  const changed = etf.holdings.some((h) => bps(weights[h.token] ?? '0') !== h.targetWeightBps);
  const drift = Math.max(0, ...etf.holdings.map((h) => Math.abs(h.actualWeightBps - h.targetWeightBps)));
  const listed = useListedStocks();
  const held = new Set(etf.holdings.map((h) => h.token.toLowerCase()));
  const match = useMemo(() => {
    const q = newStock.trim().toLowerCase();
    return q ? STOCKS.find((s) => !held.has(s.address.toLowerCase()) && (s.symbol.toLowerCase() === q || s.testSymbol.toLowerCase() === q)) : undefined;
     
  }, [newStock, etf.holdings]);
  const notListed = Boolean(match && listed && !listed.has(match.address.toLowerCase()));
  const candidate = notListed ? undefined : match;

  const next = { managementFeeBps: bps(mgmt), entryFeeBps: bps(entry), exitFeeBps: bps(exit) };
  const feeTooHigh =
    next.managementFeeBps > FEE_LIMITS.managementBps || next.entryFeeBps > FEE_LIMITS.entryBps || next.exitFeeBps > FEE_LIMITS.exitBps;
  const isIncrease =
    next.managementFeeBps > etf.fees.managementFeeBps || next.entryFeeBps > etf.fees.entryFeeBps || next.exitFeeBps > etf.fees.exitFeeBps;
  const feesChanged = JSON.stringify(next) !== JSON.stringify(etf.fees);
  const canApplyPending = Boolean(etf.pendingFees && Date.now() / 1000 >= etf.pendingFeesEta);
  const keepPct = 1 - etf.protocolFeeBps / 10_000;
  const yearly = etf.totalValueUsd * (etf.fees.managementFeeBps / 10_000) * keepPct;
  const accruedUsd = etf.accruedFeeShares * etf.navPerShare * keepPct;

  return (
    <Card className="border-primary/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Scale className="h-5 w-5" /> Manager console</CardTitle>
        <CardDescription>
          Fees arrive as {etf.symbol} shares in {short(etf.feeRecipient)}. Redeem them like any holder to cash out.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Earned to date" value={usd(etf.managerFeesUsd)} sub="at value when paid" />
          <Stat label="Accruing now" value={usd(accruedUsd, 4)} sub="not yet minted" />
          <Stat label="Run rate" value={`${usd(yearly)}/yr`} sub={`at today's AUM, after ${bpsToPct(etf.protocolFeeBps, 0)} protocol share`} />
          <Stat
            label="Fees paid to"
            value={short(etf.feeRecipient)}
            sub={etf.account && etf.feeRecipient.toLowerCase() === etf.account.address.toLowerCase() ? 'this wallet' : 'another address'}
          />
        </div>
        <Button variant="outline" size="sm" disabled={!!busy || etf.accruedFeeShares === 0} onClick={() => run('Collect fees', () => send((v) => v.accrueFees()))}>
          {busy === 'Collect fees' ? 'Collecting…' : 'Collect accrued fees'}
        </Button>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <h3 className="font-semibold">Weights &amp; rebalancing</h3>
            <div className="divide-y rounded-md border">
              {etf.holdings.map((h) => (
                <div key={h.token} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="flex-1 font-medium">{h.symbol}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">now {bpsToPct(h.actualWeightBps)}</span>
                  <Input
                    inputMode="decimal"
                    className="h-8 w-20 text-right tabular-nums"
                    aria-label={`${h.symbol} target weight`}
                    value={weights[h.token] ?? ''}
                    onChange={(e) => setWeights({ ...weights, [h.token]: e.target.value })}
                  />
                  <span className="text-muted-foreground">%</span>
                </div>
              ))}
              <div className="flex justify-between px-3 py-2 text-sm">
                <span className="text-muted-foreground">Total (set a stock to 0% to drop it)</span>
                <span className={`font-medium tabular-nums ${totalBps === 10_000 ? '' : 'text-red-500'}`}>{(totalBps / 100).toFixed(2)}%</span>
              </div>
            </div>
            <div className="flex gap-2">
              <Input placeholder="Add stock by ticker, e.g. AMDc" aria-label="Add stock ticker" value={newStock} onChange={(e) => setNewStock(e.target.value)} />
              <Button
                variant="outline"
                disabled={!candidate || !!busy || etf.holdings.length >= FEE_LIMITS.maxAssets}
                onClick={() => run(`Add ${candidate!.testSymbol}`, async () => { const h = await send((v) => v.addAsset(candidate!.address, 0)); setNewStock(''); return h; })}
              >
                Add
              </Button>
            </div>
            {notListed && <p className="text-xs text-red-500">{match!.testSymbol} isn&apos;t listed on the exchange yet, so an ITF can&apos;t hold it.</p>}
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={!!busy || !changed || totalBps !== 10_000}
                onClick={() =>
                  run('Save weights', () => {
                    const rows = etf.holdings.map((h) => [h.token, bps(weights[h.token] ?? '0')] as const);
                    return send((v) => v.setWeights(rows.map((r) => r[0]), rows.map((r) => r[1])));
                  })
                }
              >
                {busy === 'Save weights' ? 'Saving…' : 'Save weights'}
              </Button>
              <Button variant="outline" disabled={!!busy || etf.paused} onClick={() => run('Rebalance', () => send((v) => v.rebalance()))}>
                {busy === 'Rebalance' ? 'Rebalancing…' : `Rebalance (drift ${bpsToPct(drift)})`}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Rebalancing trades at NAV, so it doesn&apos;t change the fund&apos;s value. Prices must be under 7 days old; the protocol agent syncs them on a schedule.</p>
          </div>

          <div className="space-y-3">
            <h3 className="font-semibold">Fees</h3>
            <div className="grid grid-cols-3 gap-2">
              {[
                ['Mgmt / yr', mgmt, setMgmt, FEE_LIMITS.managementBps],
                ['Entry', entry, setEntry, FEE_LIMITS.entryBps],
                ['Exit', exit, setExit, FEE_LIMITS.exitBps],
              ].map(([label, value, set, max]) => (
                <div key={label as string} className="space-y-1">
                  <Label className="text-xs">{label as string}</Label>
                  <div className="flex items-center gap-1">
                    <Input inputMode="decimal" className="h-8 tabular-nums" value={value as string} onChange={(e) => (set as (v: string) => void)(e.target.value.replace(/[^0-9.]/g, ''))} />
                    <span className="text-xs text-muted-foreground">%</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">max {(max as number) / 100}%</p>
                </div>
              ))}
            </div>
            <Button
              disabled={!!busy || !feesChanged || feeTooHigh}
              onClick={() => run(isIncrease ? 'Schedule fee change' : 'Lower fees', () => send((v) => v.setFees(next)))}
            >
              {isIncrease ? `Schedule increase (${FEE_LIMITS.timelockDays}-day notice)` : 'Lower fees now'}
            </Button>
            {etf.pendingFees && (
              <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                <span>
                  Queued: {bpsToPct(etf.pendingFees.managementFeeBps)} / {bpsToPct(etf.pendingFees.entryFeeBps)} / {bpsToPct(etf.pendingFees.exitFeeBps)}
                </span>
                <Button size="sm" variant="outline" disabled={!!busy || !canApplyPending} onClick={() => run('Apply fees', () => send((v) => v.applyPendingFees()))}>
                  {canApplyPending ? 'Apply' : `Ready ${new Date(etf.pendingFeesEta * 1000).toLocaleDateString()}`}
                </Button>
              </div>
            )}
            <div className="border-t pt-3">
              <Button
                variant={etf.paused ? 'outline' : 'destructive'}
                size="sm"
                disabled={!!busy}
                onClick={() => run(etf.paused ? 'Unpause' : 'Pause', () => send((v) => (etf.paused ? v.emergencyUnpause() : v.emergencyPause())))}
              >
                {etf.paused ? 'Unpause ITF' : 'Pause deposits'}
              </Button>
              <p className="mt-1 text-xs text-muted-foreground">Pausing stops deposits, cash redemptions and rebalancing. Holders can still redeem in kind.</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
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
