'use client';

import { useState } from 'react';
import { VIZ_OTHER, useWidth } from './chart-utils';

export interface AllocationPart {
  id: string;
  label: string;
  value: number;
  /** Fill colour; assign by entity (never by rank) so a colour keeps meaning across views. */
  color: string;
  sub?: string;
}

/** Keep the `max - 1` largest parts and fold the rest into one grey "Other" part (never more than `max` blocks). */
export function foldParts(parts: AllocationPart[], max = 6): AllocationPart[] {
  const positive = parts.filter((p) => p.value > 0);
  if (positive.length <= max) return positive;
  const keep = new Set([...positive].sort((a, b) => b.value - a.value).slice(0, max - 1).map((p) => p.id));
  const rest = positive.filter((p) => !keep.has(p.id));
  return [
    ...positive.filter((p) => keep.has(p.id)),
    { id: '__other', label: `Other (${rest.length})`, value: rest.reduce((a, p) => a + p.value, 0), color: VIZ_OTHER },
  ];
}

// Light fills (orange, aqua, yellow, pink in light mode) take near-black text; the rest take white.
const DARK_TEXT_SLOTS = new Set(['var(--viz-2)', 'var(--viz-3)', 'var(--viz-4)', 'var(--viz-5)', VIZ_OTHER]);
const MIN_LABEL_PX = 44;
const GAP = 2;

/** Tall segmented bar (one whole split into parts) + legend. The legend doubles as the table view. */
export function AllocationBar({ parts, label, format }: { parts: AllocationPart[]; label: string; format: (v: number) => string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<string | null>(null);
  const total = parts.reduce((a, p) => a + p.value, 0);
  if (!(total > 0)) return null;

  const share = (p: AllocationPart) => (p.value / total) * 100;
  const usable = Math.max(0, width - GAP * (parts.length - 1));
  const shown = parts.find((p) => p.id === active);

  return (
    <div className="space-y-3">
      <div ref={ref} className="relative">
        <div className="flex h-7" style={{ gap: GAP }} role="list" aria-label={label}>
          {width > 0 &&
            parts.map((p) => {
              const w = (p.value / total) * usable;
              const pct = share(p);
              return (
                <div
                  key={p.id}
                  role="listitem"
                  tabIndex={0}
                  aria-label={`${p.label}: ${format(p.value)}, ${pct.toFixed(1)}%`}
                  className="flex shrink-0 items-center overflow-hidden rounded px-2 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  style={{
                    width: Math.max(w, 2),
                    background: p.color,
                    color: DARK_TEXT_SLOTS.has(p.color) ? '#191919' : '#ffffff',
                    opacity: active && active !== p.id ? 0.55 : 1,
                  }}
                  onPointerEnter={() => setActive(p.id)}
                  onPointerLeave={() => setActive(null)}
                  onFocus={() => setActive(p.id)}
                  onBlur={() => setActive(null)}
                >
                  {w >= MIN_LABEL_PX && <span className="tabular-nums">{pct < 10 ? pct.toFixed(1) : Math.round(pct)}%</span>}
                </div>
              );
            })}
        </div>
        {shown && (
          <div role="status" className="pointer-events-none absolute left-0 top-9 z-10 rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
            <span className="font-medium">{shown.label}</span>
            <span className="ml-2 tabular-nums">{format(shown.value)}</span>
            <span className="ml-2 tabular-nums text-muted-foreground">{share(shown).toFixed(1)}%</span>
          </div>
        )}
      </div>
      <ul className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
        {parts.map((p) => (
          <li key={p.id} className="flex min-w-0 items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: p.color }} aria-hidden />
            <span className="min-w-0 truncate">
              {p.label}
              {p.sub && <span className="ml-1 text-muted-foreground">{p.sub}</span>}
            </span>
            <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
              {format(p.value)} · {share(p).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
