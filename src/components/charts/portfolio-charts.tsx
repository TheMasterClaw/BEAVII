'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { Portfolio } from '@/lib/etf';
import { AllocationBar, type AllocationPart } from './allocation-bar';
import { LineChart, type LineSeries } from './line-chart';
import { HistoryEmpty, RANGES, RangePicker, useNavHistory, type RangeId } from './nav-history';
import { VIZ_OTHER, VIZ_SLOTS, fmtPct, fmtUsd } from './chart-utils';

const MAX_LINES = 4; // + "Other" + cash = at most 6 allocation blocks; <= 4 lines get direct labels

/**
 * Dashboard charts from real data: where the account's money sits (ITF positions + cash), and how each of its
 * ITFs' share price moved, indexed to % change so ITFs with very different NAVs share one axis.
 */
export function PortfolioCharts({ data }: { data: Portfolio }) {
  const [range, setRange] = useState<RangeId>('3M');
  const days = RANGES.find((r) => r.id === range)!.days;

  // ITFs the account holds or manages, biggest positions first, capped so lines stay distinguishable
  const etfs = useMemo(() => {
    const byAddr = new Map<string, { address: string; symbol: string; value: number }>();
    for (const p of data.positions) byAddr.set(p.etf.address.toLowerCase(), { address: p.etf.address, symbol: p.etf.symbol, value: p.valueUsd });
    for (const e of data.managed) if (!byAddr.has(e.address.toLowerCase())) byAddr.set(e.address.toLowerCase(), { address: e.address, symbol: e.symbol, value: 0 });
    return [...byAddr.values()].sort((a, b) => b.value - a.value);
  }, [data]);

  const lineEtfs = etfs.slice(0, MAX_LINES);
  const { data: hist, error } = useNavHistory(lineEtfs.map((e) => e.address), days);

  // Colour follows the ITF, not its rank: slots go by address within the featured set, so a fund keeps its
  // colour while values move. Everything else is grey "Other"; cash always takes the last slot.
  const colorOf = useMemo(() => {
    const ordered = lineEtfs.map((e) => e.address.toLowerCase()).sort();
    return (addr: string) => {
      const i = ordered.indexOf(addr.toLowerCase());
      return i >= 0 ? VIZ_SLOTS[i] : VIZ_OTHER;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineEtfs.map((e) => e.address).join()]);

  const featured = new Set(lineEtfs.map((e) => e.address.toLowerCase()));
  const rest = data.positions.filter((p) => !featured.has(p.etf.address.toLowerCase()));
  const parts: AllocationPart[] = [
    ...data.positions
      .filter((p) => featured.has(p.etf.address.toLowerCase()))
      .map((p) => ({ id: p.etf.address, label: p.etf.symbol, sub: p.etf.name, value: p.valueUsd, color: colorOf(p.etf.address) })),
    { id: 'other', label: `Other ITFs (${rest.length})`, value: rest.reduce((a, p) => a + p.valueUsd, 0), color: VIZ_OTHER },
    { id: 'cash', label: 'Cash', sub: 'tUSDC', value: data.cash, color: VIZ_SLOTS[VIZ_SLOTS.length - 1] },
  ].filter((p) => p.value > 0);

  const series: LineSeries[] = lineEtfs
    .map((e) => {
      const pts = hist?.history[e.address.toLowerCase()] ?? [];
      const base = pts[0]?.nav;
      return { id: e.address, name: e.symbol, color: colorOf(e.address), points: base > 0 ? pts.map((p) => ({ t: p.t, v: (p.nav / base - 1) * 100 })) : [] };
    })
    .filter((s) => s.points.length >= 2);

  const hasAllocation = parts.length > 0;
  if (!hasAllocation && etfs.length === 0) return null;

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      {hasAllocation && (
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Where your money is</CardTitle>
            <CardDescription>ITF positions at current NAV, plus test cash.</CardDescription>
          </CardHeader>
          <CardContent>
            <AllocationBar parts={parts} label="Portfolio allocation" format={(v) => fmtUsd(v)} />
          </CardContent>
        </Card>
      )}
      {etfs.length > 0 && (
        <Card className={hasAllocation ? 'lg:col-span-3' : 'lg:col-span-5'}>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Share price change</CardTitle>
              <CardDescription>
                % change in NAV per share since the start of the range
                {etfs.length > MAX_LINES ? ` · your ${MAX_LINES} largest ITFs` : ''}
              </CardDescription>
            </div>
            <RangePicker value={range} onChange={setRange} />
          </CardHeader>
          <CardContent>
            {error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : !hist ? (
              <div className="h-60 animate-pulse rounded-md bg-muted" />
            ) : series.length === 0 ? (
              <HistoryEmpty enabled={hist.enabled} />
            ) : (
              <LineChart
                series={series}
                label={`Percent change in NAV per share over the last ${range} for ${series.map((s) => s.name).join(', ')}`}
                formatY={(v) => fmtPct(v, 2)}
                formatTick={(v) => fmtPct(v, Math.abs(v) < 1 && v !== 0 ? 1 : 0)}
                baseline={0}
              />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
