'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ethers } from 'ethers';
import { Search, Wallet, X } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { STOCKS, type TestStock } from '@/config/base-sepolia';
import { ETF_FACTORY_ABI, ETF_FACTORY_ADDRESS, FACTORY_DEPLOYED, FEE_LIMITS, estimateManagerYearlyUsd } from '@/lib/etf';
import { txErrorMessage, useInjectedWallet } from '@/hooks/use-injected-wallet';

type Stock = TestStock & { priceUsd?: number | null };
interface Pick {
  stock: Stock;
  weightPct: string; // user-editable percent
}

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: n < 100 ? 2 : 0 });
const pctToBps = (s: string) => Math.round(Number(s || 0) * 100);

export function CreateETFForm() {
  const router = useRouter();
  const { account, wrongChain, connect, getSigner } = useInjectedWallet();
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [description, setDescription] = useState('');
  const [query, setQuery] = useState('');
  const [picks, setPicks] = useState<Pick[]>([]);
  const [mgmtPct, setMgmtPct] = useState('1.00');
  const [entryPct, setEntryPct] = useState('0.10');
  const [exitPct, setExitPct] = useState('0.10');
  const [feeRecipient, setFeeRecipient] = useState('');
  const [aum, setAum] = useState('100000');
  const [protocolFeeBps, setProtocolFeeBps] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/etfs', { cache: 'no-store' })
      .then((r) => r.json())
      .then((b) => setProtocolFeeBps(typeof b.protocolFeeBps === 'number' ? b.protocolFeeBps : null))
      .catch(() => {});
  }, []);

  const picked = useMemo(() => new Set(picks.map((p) => p.stock.address)), [picks]);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (STOCKS as Stock[]).filter((s) => !picked.has(s.address));
    if (!q) return list.slice(0, 12);
    return list
      .filter((s) => s.symbol.toLowerCase().includes(q) || s.testSymbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
      .slice(0, 12);
  }, [query, picked]);

  const totalBps = picks.reduce((a, p) => a + pctToBps(p.weightPct), 0);
  const fees = { managementFeeBps: pctToBps(mgmtPct), entryFeeBps: pctToBps(entryPct), exitFeeBps: pctToBps(exitPct) };
  const feeErrors = [
    fees.managementFeeBps > FEE_LIMITS.managementBps && `Management fee max ${FEE_LIMITS.managementBps / 100}%`,
    fees.entryFeeBps > FEE_LIMITS.entryBps && `Entry fee max ${FEE_LIMITS.entryBps / 100}%`,
    fees.exitFeeBps > FEE_LIMITS.exitBps && `Exit fee max ${FEE_LIMITS.exitBps / 100}%`,
    [mgmtPct, entryPct, exitPct].some((v) => !(Number(v) >= 0)) && 'Fees must be zero or more',
  ].filter(Boolean) as string[];
  const recipientError = feeRecipient && !ethers.isAddress(feeRecipient) ? 'Not a valid address' : null;
  const cut = protocolFeeBps ?? 0;
  const aumN = Math.max(0, Number(aum) || 0);
  const yearlyMgmt = estimateManagerYearlyUsd(aumN, fees, cut);
  const yearlyEntry = aumN * (fees.entryFeeBps / 10_000) * (1 - cut / 10_000);

  const problems = [
    !name.trim() && 'Add a name',
    !symbol.trim() && 'Add a ticker symbol',
    picks.length === 0 && 'Pick at least one stock',
    picks.length > 0 && totalBps !== 10_000 && `Weights add up to ${(totalBps / 100).toFixed(2)}%, not 100%`,
    picks.some((p) => pctToBps(p.weightPct) <= 0) && 'Every stock needs a weight above 0',
    ...feeErrors,
    recipientError,
  ].filter(Boolean) as string[];

  const add = (s: Stock) => {
    if (picks.length >= FEE_LIMITS.maxAssets) return;
    const next = [...picks, { stock: s, weightPct: '0' }];
    setPicks(equalize(next));
    setQuery('');
  };
  const remove = (addr: string) => setPicks(equalize(picks.filter((p) => p.stock.address !== addr)));
  const setWeight = (addr: string, v: string) => setPicks(picks.map((p) => (p.stock.address === addr ? { ...p, weightPct: v } : p)));

  const submit = async () => {
    setError(null);
    if (problems.length) return;
    setBusy(true);
    try {
      const signer = await getSigner();
      const factory = new ethers.Contract(ETF_FACTORY_ADDRESS, ETF_FACTORY_ABI, signer);
      const tx = await factory.createETF({
        name: name.trim(),
        symbol: symbol.trim(),
        description: description.trim(),
        feeRecipient: feeRecipient || ethers.ZeroAddress,
        tokens: picks.map((p) => p.stock.address),
        weights: picks.map((p) => pctToBps(p.weightPct)),
        fees,
      });
      const receipt = await tx.wait();
      const ev = receipt.logs
        .map((l: ethers.Log) => {
          try {
            return factory.interface.parseLog(l);
          } catch {
            return null;
          }
        })
        .find((e: ethers.LogDescription | null) => e?.name === 'ETFCreated');
      router.push(ev ? `/dashboard/etfs/${ev.args.vault}?created=1` : '/dashboard/etfs');
    } catch (e) {
      setError(txErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (!FACTORY_DEPLOYED) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>ETF factory not deployed</CardTitle>
          <CardDescription>Run `node scripts/deploy-base-sepolia.mjs` to deploy the Base Sepolia contracts.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">1. Name your ETF</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-[1fr_160px]">
            <div className="space-y-1.5">
              <Label htmlFor="etf-name">Name</Label>
              <Input id="etf-name" maxLength={64} placeholder="AI Infrastructure Leaders" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="etf-symbol">Ticker</Label>
              <Input
                id="etf-symbol"
                maxLength={12}
                placeholder="AINFRA"
                className="font-mono uppercase"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9.]/g, ''))}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="etf-desc">Strategy (shown to investors)</Label>
              <textarea
                id="etf-desc"
                rows={2}
                maxLength={280}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Chipmakers and cloud platforms powering AI, rebalanced monthly."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">2. Pick stocks and weights</CardTitle>
              <CardDescription>
                Up to {FEE_LIMITS.maxAssets} stocks from {STOCKS.length} listed. Weights must total 100%.
              </CardDescription>
            </div>
            {picks.length > 1 && (
              <Button variant="outline" size="sm" onClick={() => setPicks(equalize(picks))}>
                Equal weight
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search by ticker or company"
                aria-label="Search stocks"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                disabled={picks.length >= FEE_LIMITS.maxAssets}
              />
            </div>
            {results.length > 0 && picks.length < FEE_LIMITS.maxAssets && (
              <div className="flex flex-wrap gap-2">
                {results.map((s) => (
                  <button
                    key={s.address}
                    type="button"
                    onClick={() => add(s)}
                    className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs hover:bg-muted"
                    title={s.name}
                  >
                    {s.iconUrl && <img src={s.iconUrl} alt="" width={14} height={14} className="rounded-full" />}
                    <span className="font-medium">{s.symbol}</span>
                    <span className="text-muted-foreground">+</span>
                  </button>
                ))}
              </div>
            )}

            {picks.length > 0 && (
              <div className="divide-y rounded-md border">
                {picks.map((p) => (
                  <div key={p.stock.address} className="flex items-center gap-3 px-3 py-2">
                    {p.stock.iconUrl && <img src={p.stock.iconUrl} alt="" width={24} height={24} className="rounded-full" />}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{p.stock.testSymbol}</div>
                      <div className="truncate text-xs text-muted-foreground">{p.stock.name}</div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Input
                        inputMode="decimal"
                        className="h-8 w-20 text-right tabular-nums"
                        aria-label={`${p.stock.symbol} weight percent`}
                        value={p.weightPct}
                        onChange={(e) => setWeight(p.stock.address, e.target.value)}
                      />
                      <span className="text-sm text-muted-foreground">%</span>
                    </div>
                    <Button variant="ghost" size="sm" aria-label={`Remove ${p.stock.symbol}`} onClick={() => remove(p.stock.address)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <div className="flex justify-between px-3 py-2 text-sm">
                  <span className="text-muted-foreground">Total</span>
                  <span className={`tabular-nums font-medium ${totalBps === 10_000 ? '' : 'text-red-500'}`}>{(totalBps / 100).toFixed(2)}%</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">3. Set your fees</CardTitle>
            <CardDescription>
              Fees are paid to you as new ETF shares, so your earnings grow with the fund. You can lower fees at any time.
              Raising them waits {FEE_LIMITS.timelockDays} days so holders can leave first.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <FeeInput id="fee-mgmt" label="Management / yr" hint={`max ${FEE_LIMITS.managementBps / 100}%`} value={mgmtPct} onChange={setMgmtPct} />
            <FeeInput id="fee-entry" label="Entry" hint={`max ${FEE_LIMITS.entryBps / 100}%`} value={entryPct} onChange={setEntryPct} />
            <FeeInput id="fee-exit" label="Exit" hint={`max ${FEE_LIMITS.exitBps / 100}%`} value={exitPct} onChange={setExitPct} />
            <div className="space-y-1.5 sm:col-span-3">
              <Label htmlFor="fee-recipient">Pay fees to (optional)</Label>
              <Input
                id="fee-recipient"
                className="font-mono"
                placeholder={account || 'Your wallet'}
                value={feeRecipient}
                onChange={(e) => setFeeRecipient(e.target.value.trim())}
              />
              {recipientError && <p className="text-xs text-red-500">{recipientError}</p>}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">What you earn</CardTitle>
            <CardDescription>
              {protocolFeeBps == null ? 'Loading protocol share…' : `You keep ${100 - cut / 100}% of every fee; the protocol keeps ${cut / 100}%.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="aum">If investors put in</Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">$</span>
                <Input id="aum" inputMode="decimal" className="tabular-nums" value={aum} onChange={(e) => setAum(e.target.value.replace(/[^0-9.]/g, ''))} />
              </div>
            </div>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Management, per year</dt>
                <dd className="tabular-nums font-medium">{usd(yearlyMgmt)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Entry fees on that inflow</dt>
                <dd className="tabular-nums font-medium">{usd(yearlyEntry)}</dd>
              </div>
              <div className="flex justify-between border-t pt-2">
                <dt>First-year total</dt>
                <dd className="tabular-nums font-semibold">{usd(yearlyMgmt + yearlyEntry)}</dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">Plus exit fees on redemptions. Excludes price changes in the fee shares you hold.</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 pt-6">
            {problems.length > 0 && (
              <ul className="space-y-1 text-xs text-muted-foreground">
                {problems.map((p) => (
                  <li key={p}>• {p}</li>
                ))}
              </ul>
            )}
            {error && (
              <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm">
                {error}
              </p>
            )}
            {account ? (
              <Button className="w-full" disabled={busy || problems.length > 0} onClick={submit}>
                {busy ? 'Confirm in wallet…' : wrongChain ? 'Switch to Base Sepolia & launch' : 'Launch ETF'}
              </Button>
            ) : (
              <Button className="w-full" onClick={() => connect().catch((e) => setError(txErrorMessage(e)))}>
                <Wallet className="mr-1 h-4 w-4" /> Connect wallet
              </Button>
            )}
            <p className="text-xs text-muted-foreground">
              You become the manager. One transaction, roughly 0.8M gas on Base Sepolia. <Badge variant="outline">Testnet</Badge>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function FeeInput({ id, label, hint, value, onChange }: { id: string; label: string; hint: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-1">
        <Input id={id} inputMode="decimal" className="tabular-nums" value={value} onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ''))} />
        <span className="text-sm text-muted-foreground">%</span>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

/** Split 100% evenly (2-decimal percents); the first stock absorbs the rounding remainder. */
function equalize(picks: Pick[]): Pick[] {
  if (!picks.length) return picks;
  const base = Math.floor(10_000 / picks.length);
  return picks.map((p, i) => ({ ...p, weightPct: ((i === 0 ? 10_000 - base * (picks.length - 1) : base) / 100).toFixed(2) }));
}
