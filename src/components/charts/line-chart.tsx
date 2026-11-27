'use client';

import { useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { fmtDate, fmtDateLong, niceTicks, useWidth } from './chart-utils';

export interface LineSeries {
  id: string;
  name: string;
  color: string;
  points: { t: number; v: number }[]; // t = unix seconds, ascending
}

interface LineChartProps {
  series: LineSeries[];
  /** Accessible summary of what the chart shows. */
  label: string;
  formatY: (v: number) => string;
  /** Axis tick format (defaults to formatY). */
  formatTick?: (v: number) => string;
  /** Emphasized reference line, e.g. 0 for a % change chart. */
  baseline?: number;
  height?: number;
}

const TOP = 12;
const BOTTOM = 26;
const LABEL_GAP = 14; // min vertical space between direct labels

/** Nearest point of a series to time t (points ascending). */
function nearest(points: LineSeries['points'], t: number) {
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[lo - 1];
  return b && Math.abs(b.t - t) <= Math.abs(a.t - t) ? b : a;
}

export function LineChart({ series, label, formatY, formatTick = formatY, baseline, height = 240 }: LineChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const live = series.filter((s) => s.points.length > 0);
  const times = useMemo(() => [...new Set(live.flatMap((s) => s.points.map((p) => p.t)))].sort((a, b) => a - b), [live]);

  const values = live.flatMap((s) => s.points.map((p) => p.v));
  if (baseline !== undefined) values.push(baseline);
  const ticks = niceTicks(Math.min(...values), Math.max(...values), 4);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const tickLabels = ticks.map(formatTick);

  const multi = live.length >= 2;
  const direct = multi && live.length <= 4;
  const left = 8 + Math.max(...tickLabels.map((l) => l.length)) * 6.5;
  const right = direct ? 96 : 12;
  const plotW = Math.max(10, width - left - right);
  const plotH = height - TOP - BOTTOM;
  const t0 = times[0];
  const t1 = times[times.length - 1];
  const x = (t: number) => left + (t1 === t0 ? plotW / 2 : ((t - t0) / (t1 - t0)) * plotW);
  const y = (v: number) => TOP + (1 - (v - yMin) / (yMax - yMin || 1)) * plotH;

  // Date ticks: evenly spaced, about one per 90px, no repeated labels
  const xTicks = useMemo(() => {
    if (!times.length) return [];
    if (t1 === t0) return [t0];
    const n = Math.max(2, Math.min(6, Math.floor(plotW / 90)));
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const t = t0 + ((t1 - t0) * i) / (n - 1);
      if (!out.length || fmtDate(t) !== fmtDate(out[out.length - 1])) out.push(t);
    }
    return out;
  }, [times, t0, t1, plotW]);

  // Direct labels at each line's end, nudged apart so they never overlap
  const endLabels = useMemo(() => {
    if (!direct) return [];
    const ls = live.map((s) => ({ s, y: y(s.points[s.points.length - 1].v) })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < ls.length; i++) ls[i].y = Math.max(ls[i].y, ls[i - 1].y + LABEL_GAP);
    const overflow = ls.length ? ls[ls.length - 1].y - (TOP + plotH) : 0;
    if (overflow > 0) ls.forEach((l) => (l.y -= overflow));
    return ls;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [direct, live, yMin, yMax, plotH]);

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!times.length) return;
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
    const t = t0 + ((px - left) / plotW) * (t1 - t0);
    let best = 0;
    times.forEach((tt, i) => {
      if (Math.abs(tt - t) < Math.abs(times[best] - t)) best = i;
    });
    setHover(best);
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const d = e.key === 'ArrowRight' ? 1 : -1;
      setHover((h) => Math.min(times.length - 1, Math.max(0, (h ?? (d > 0 ? -1 : times.length)) + d)));
    } else if (e.key === 'Escape') setHover(null);
  };

  const ht = hover !== null ? times[hover] : null;
  const hx = ht !== null ? x(ht) : 0;
  const hovered = ht !== null ? live.map((s) => ({ s, p: nearest(s.points, ht) })) : [];

  return (
    <div className="space-y-2">
      {multi && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
          {live.map((s) => (
            <li key={s.id} className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-3 rounded-full" style={{ background: s.color }} aria-hidden />
              {s.name}
            </li>
          ))}
        </ul>
      )}
      <div ref={ref} className="relative" style={{ height }}>
        {width > 0 && times.length > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={label}
            tabIndex={0}
            className="touch-pan-y outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            onPointerMove={onMove}
            onPointerDown={onMove}
            onPointerLeave={() => setHover(null)}
            onKeyDown={onKey}
            onBlur={() => setHover(null)}
          >
            {/* grid + y axis */}
            {ticks.map((v, i) => (
              <g key={v}>
                <line x1={left} x2={left + plotW} y1={y(v)} y2={y(v)} stroke="var(--muted-foreground)" strokeOpacity={0.15} strokeWidth={1} />
                <text x={left - 8} y={y(v)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--muted-foreground)" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {tickLabels[i]}
                </text>
              </g>
            ))}
            {baseline !== undefined && <line x1={left} x2={left + plotW} y1={y(baseline)} y2={y(baseline)} stroke="var(--muted-foreground)" strokeOpacity={0.55} strokeWidth={1} />}
            {/* x axis */}
            {xTicks.map((t, i) => (
              <text
                key={t}
                x={x(t)}
                y={height - 8}
                fontSize={11}
                fill="var(--muted-foreground)"
                textAnchor={xTicks.length === 1 ? 'middle' : i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
              >
                {fmtDate(t)}
              </text>
            ))}
            {/* lines */}
            {live.map((s) =>
              s.points.length === 1 ? (
                <circle key={s.id} cx={x(s.points[0].t)} cy={y(s.points[0].v)} r={4} fill={s.color} />
              ) : (
                <path
                  key={s.id}
                  d={s.points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('')}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ),
            )}
            {/* direct labels */}
            {endLabels.map(({ s, y: ly }) => {
              const last = s.points[s.points.length - 1];
              return (
                <g key={s.id}>
                  <line x1={x(last.t) + 6} x2={x(last.t) + 14} y1={ly} y2={ly} stroke={s.color} strokeWidth={2} strokeLinecap="round" />
                  <text x={x(last.t) + 18} y={ly} dy="0.32em" fontSize={11} fill="var(--foreground)">
                    {s.name.length > 12 ? `${s.name.slice(0, 11)}…` : s.name}
                  </text>
                </g>
              );
            })}
            {/* hover crosshair + markers */}
            {ht !== null && (
              <g pointerEvents="none">
                <line x1={hx} x2={hx} y1={TOP} y2={TOP + plotH} stroke="var(--muted-foreground)" strokeWidth={1} />
                {hovered.map(({ s, p }) => (
                  <circle key={s.id} cx={x(p.t)} cy={y(p.v)} r={4} fill={s.color} stroke="var(--card)" strokeWidth={2} />
                ))}
              </g>
            )}
          </svg>
        )}
        {ht !== null && (
          <div
            role="status"
            className="pointer-events-none absolute top-0 z-10 min-w-36 rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
            style={hx > width / 2 ? { right: width - hx + 12 } : { left: hx + 12 }}
          >
            <div className="mb-1 font-medium">{fmtDateLong(ht)}</div>
            {hovered.map(({ s, p }) => (
              <div key={s.id} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  {multi && <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} aria-hidden />}
                  {multi ? s.name : 'Value'}
                </span>
                <span className="tabular-nums">{formatY(p.v)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">Show data table</summary>
        <div className="mt-2 max-h-56 overflow-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b text-left">
                <th className="py-1 pr-4 font-medium">Date</th>
                {live.map((s) => (
                  <th key={s.id} className="py-1 pr-4 text-right font-medium">{multi ? s.name : 'Value'}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...times].reverse().map((t) => (
                <tr key={t} className="border-b last:border-0">
                  <td className="py-1 pr-4">{fmtDateLong(t)}</td>
                  {live.map((s) => {
                    const p = s.points.find((q) => q.t === t);
                    return <td key={s.id} className="py-1 pr-4 text-right tabular-nums text-foreground">{p ? formatY(p.v) : ''}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
