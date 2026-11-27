'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LineChart, type LineSeries } from './line-chart';
import { VIZ_SLOTS, fmtPct, fmtSpan, fmtUsd, fmtUsdCompact } from './chart-utils';

export interface NavPointDto {
  t: number;
  nav: number;
  aum: number;
}
export type NavHistoryResponse = { enabled: boolean; history: Record<string, NavPointDto[]> };

export const RANGES = [
  { id: '1M', days: 30 },
  { id: '3M', days: 90 },
  { id: '6M', days: 180 },
  { id: '1Y', days: 365 },
] as const;
export type RangeId = (typeof RANGES)[number]['id'];

/** Fetch NAV history for up to 10 ITFs. `null` while loading. */
export function useNavHistory(etfs: string[], days: number) {
  const [data, setData] = useState<NavHistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = [...etfs].map((a) => a.toLowerCase()).sort().join(',');
  useEffect(() => {
    if (!key) return setData({ enabled: true, history: {} });
    let cancelled = false;
    setData(null);
    const qs = key.split(',').map((a) => `etf=${a}`).join('&');
    fetch(`/api/nav-history?${qs}&days=${days}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error);
        if (!cancelled) {
          setData(body);
          setError(null);
        }
      })
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [key, days]);
  return { data, error };
}

export function RangePicker({ value, onChange }: { value: RangeId; onChange: (r: RangeId) => void }) {
  return (
    <div className="flex gap-1" role="group" aria-label="Time range">
      {RANGES.map((r) => (
        <Button key={r.id} size="sm" variant={value === r.id ? 'secondary' : 'ghost'} className="h-7 px-2.5 text-xs" aria-pressed={value === r.id} onClick={() => onChange(r.id)}>
          {r.id}
        </Button>
      ))}
    </div>
  );
}

export function HistoryEmpty({ enabled }: { enabled: boolean }) {
  return (
    <div className="flex h-40 items-center justify-center rounded-md border border-dashed px-6 text-center text-sm text-muted-foreground">
      {enabled
        ? 'Not enough history yet. A point is recorded each time prices sync (weekdays), and past days are filled in from the chain.'
        : 'Price history is off: this deployment has no database configured.'}
    </div>
  );
}

/** NAV per share over time for one ITF. */
export function NavHistoryCard({ address, symbol }: { address: string; symbol: string }) {
  const [range, setRange] = useState<RangeId>('3M');
  const days = RANGES.find((r) => r.id === range)!.days;
  const { data, error } = useNavHistory([address], days);
  const points = data?.history[address.toLowerCase()] ?? [];
  const first = points[0];
  const last = points[points.length - 1];
  const change = first && last && first.nav > 0 ? (last.nav / first.nav - 1) * 100 : null;
  const series: LineSeries[] = [{ id: address, name: `NAV per ${symbol}`, color: VIZ_SLOTS[0], points: points.map((p) => ({ t: p.t, v: p.nav })) }];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">NAV per {symbol}</CardTitle>
          <CardDescription>
            {points.length >= 2 && change !== null
              ? `${fmtPct(change)} ${fmtSpan(first.t, range, days)} · ${fmtUsd(first.nav, 4)} → ${fmtUsd(last.nav, 4)}`
              : 'Value of one share over time'}
          </CardDescription>
        </div>
        <RangePicker value={range} onChange={setRange} />
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !data ? (
          <div className="h-60 animate-pulse rounded-md bg-muted" />
        ) : points.length < 2 ? (
          <HistoryEmpty enabled={data.enabled} />
        ) : (
          <LineChart
            series={series}
            label={`NAV per ${symbol} ${fmtSpan(first.t, range, days)}, from ${fmtUsd(first.nav, 4)} to ${fmtUsd(last.nav, 4)}`}
            formatY={(v) => fmtUsd(v, 4)}
            formatTick={fmtUsdCompact}
          />
        )}
      </CardContent>
    </Card>
  );
}
