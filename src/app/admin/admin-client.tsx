'use client';

import { useActionState, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, LogOut, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { loginAction, logoutAction } from './actions';

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, undefined);
  return (
    <form action={action} className="mx-auto mt-16 max-w-sm space-y-4 rounded-xl border bg-card p-6 shadow-sm">
      <div className="flex items-center gap-2 font-semibold">
        <Lock className="h-4 w-4" /> Restricted
      </div>
      <Input name="secret" type="password" autoComplete="current-password" placeholder="Admin secret" required autoFocus aria-label="Admin secret" />
      {state?.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? 'Checking…' : 'Enter'}
      </Button>
    </form>
  );
}

export function SignOutButton() {
  return (
    <form action={logoutAction}>
      <Button variant="ghost" size="sm" type="submit">
        <LogOut className="mr-1 h-4 w-4" /> Sign out
      </Button>
    </form>
  );
}

export function RefreshButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button variant="outline" size="sm" onClick={() => start(() => router.refresh())} disabled={pending}>
      <RefreshCw className={`mr-1 h-4 w-4 ${pending ? 'animate-spin' : ''}`} /> Refresh
    </Button>
  );
}

/** Single-series weekly bar chart with per-bar hover tooltip. Title names the series, so no legend. */
export function WeeklyBars({ title, points }: { title: string; points: { weekStart: number; count: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...points.map((p) => p.count));
  const total = points.reduce((a, p) => a + p.count, 0);
  const fmt = (t: number) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const h = hover === null ? null : points[hover];
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-medium">{title}</h3>
        <span className="text-xs text-muted-foreground tabular-nums">{h ? `Week of ${fmt(h.weekStart)}: ${h.count}` : `${total} in 12 weeks`}</span>
      </div>
      <div className="relative mt-3 flex h-28 items-end gap-[2px] border-b border-border" onMouseLeave={() => setHover(null)}>
        {points.map((p, i) => (
          <div key={p.weekStart} className="flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)} aria-label={`Week of ${fmt(p.weekStart)}: ${p.count}`}>
            <div
              className={`w-full rounded-t-[4px] bg-primary transition-opacity ${hover !== null && hover !== i ? 'opacity-40' : ''}`}
              style={{ height: p.count ? `${Math.max(4, (p.count / max) * 100)}%` : 0 }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
        <span>{fmt(points[0]?.weekStart ?? Date.now())}</span>
        <span>this week</span>
      </div>
    </div>
  );
}

export type Column<T> = { key: string; label: string; align?: 'right'; render: (row: T) => React.ReactNode; sort?: (row: T) => number | string };

/** Filterable, sortable table. `search` returns the text a row is matched against. */
export function DataTable<T>({ rows, columns, search, empty, rowKey }: { rows: T[]; columns: Column<T>[]; search: (row: T) => string; empty: string; rowKey: (row: T) => string }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const view = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = needle ? rows.filter((r) => search(r).toLowerCase().includes(needle)) : rows;
    const col = sort && columns.find((c) => c.key === sort.key);
    if (col?.sort && sort) {
      const f = col.sort;
      out = [...out].sort((a, b) => {
        const x = f(a);
        const y = f(b);
        return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
      });
    }
    return out;
  }, [rows, q, sort, columns, search]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" className="h-8 max-w-xs" aria-label="Filter rows" />
        <span className="text-xs text-muted-foreground tabular-nums">
          {view.length} of {rows.length}
        </span>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={`whitespace-nowrap px-3 py-2 font-medium ${c.align === 'right' ? 'text-right' : ''}`}>
                  {c.sort ? (
                    <button type="button" className="hover:text-foreground" onClick={() => setSort((s) => ({ key: c.key, dir: s?.key === c.key && s.dir === -1 ? 1 : -1 }))}>
                      {c.label}
                      {sort?.key === c.key ? (sort.dir === -1 ? ' ↓' : ' ↑') : ''}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-6 text-center text-muted-foreground">
                  {empty}
                </td>
              </tr>
            ) : (
              view.map((r) => (
                <tr key={rowKey(r)} className="border-t hover:bg-muted/30">
                  {columns.map((c) => (
                    <td key={c.key} className={`whitespace-nowrap px-3 py-2 ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}>
                      {c.render(r)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
