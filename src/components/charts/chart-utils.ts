'use client';

import { useLayoutEffect, useRef, useState } from 'react';

/** Categorical slots in fixed order (see --viz-* in globals.css). Never cycle past these: fold into "Other". */
export const VIZ_SLOTS = ['var(--viz-1)', 'var(--viz-2)', 'var(--viz-3)', 'var(--viz-4)', 'var(--viz-5)', 'var(--viz-6)'] as const;
export const VIZ_OTHER = 'var(--viz-other)';

/** Width of an element, kept current with ResizeObserver (0 until mounted). */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  // Layout effect: measure before first paint so the chart never flashes empty
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(Math.round(el.getBoundingClientRect().width));
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** About `count` round tick values covering [min, max] (steps of 1, 2, 2.5 or 5 x 10^k). */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) {
    const pad = Math.abs(min) * 0.05 || 1;
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const ticks: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(Number(v.toPrecision(12)));
  if (ticks[ticks.length - 1] < max) ticks.push(Number((ticks[ticks.length - 1] + step).toPrecision(12)));
  return ticks;
}

const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const dateFmtLong = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
export const fmtDate = (t: number) => dateFmt.format(t * 1000);
export const fmtDateLong = (t: number) => dateFmtLong.format(t * 1000);

export const fmtUsd = (n: number, digits = 2) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits });
export const fmtUsdCompact = (n: number) =>
  Math.abs(n) >= 10_000
    ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 })
    : fmtUsd(n, Math.abs(n) >= 100 ? 0 : 2);
/** "over 3M" when the data spans the range, else "since Nov 26" (history younger than the range). */
export const fmtSpan = (firstT: number, rangeLabel: string, rangeDays: number) =>
  firstT > Date.now() / 1000 - rangeDays * 86_400 + 2 * 86_400 ? `since ${fmtDate(firstT)}` : `over ${rangeLabel}`;
export const fmtPct = (n: number, digits = 1) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(digits)}%`;
