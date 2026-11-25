'use client';

import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';

export interface BarRow {
  key: string;
  label: string;
  sublabel?: string;
  value: number;
  display: string;
  href?: string;
  iconUrl?: string;
}

/**
 * Ranked single-series horizontal bars (magnitude by category). One hue, no legend: the title names the
 * series. Values sit in text ink beside each bar; the full value is in the hover title and screen-reader text.
 */
export function BarList({ rows, label, emptyText = 'Nothing to show yet.' }: { rows: BarRow[]; label: string; emptyText?: string }) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  if (!rows.length || max <= 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <ul aria-label={label} className="space-y-2">
      {rows.map((r) => {
        const pct = Math.max(1, (r.value / max) * 100);
        const name = (
          <span className="flex min-w-0 items-center gap-2">
            {r.iconUrl && <img src={r.iconUrl} alt="" width={18} height={18} className="shrink-0 rounded-full" />}
            <span className="truncate font-medium">{r.label}</span>
            {r.sublabel && <span className="truncate text-xs text-muted-foreground">{r.sublabel}</span>}
          </span>
        );
        return (
          <li key={r.key} className="group" title={`${r.label}: ${r.display}`}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              {r.href ? (
                <Link href={r.href} className="min-w-0 hover:underline">
                  {name}
                </Link>
              ) : (
                name
              )}
              <span className="shrink-0 tabular-nums">{r.display}</span>
            </div>
            <div className="h-2 w-full rounded-sm bg-muted" aria-hidden>
              <div className="h-2 rounded-r-[4px] bg-primary transition-opacity group-hover:opacity-80" style={{ width: `${pct}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        {sub && <p className="text-xs text-muted-foreground tabular-nums">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export const usd = (n: number | null | undefined, max = 2) =>
  n == null
    ? '—'
    : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: n >= 1000 ? 0 : 2, maximumFractionDigits: n >= 1000 ? 0 : max });
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
