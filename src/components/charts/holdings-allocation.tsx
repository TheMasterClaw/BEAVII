'use client';

import type { EtfHolding } from '@/lib/etf';
import { AllocationBar, type AllocationPart } from './allocation-bar';
import { VIZ_OTHER, VIZ_SLOTS, fmtUsd } from './chart-utils';

/**
 * An ITF's holdings by current value. Up to 6 stocks each get a colour in contract order; past that the 5 largest
 * by target weight (which only the manager changes) keep colours and the rest fold into "Other", so a stock's
 * colour does not jump around as prices move.
 */
export function HoldingsAllocation({ holdings }: { holdings: EtfHolding[] }) {
  const featured =
    holdings.length <= VIZ_SLOTS.length
      ? holdings
      : [...holdings].sort((a, b) => b.targetWeightBps - a.targetWeightBps).slice(0, VIZ_SLOTS.length - 1);
  const keep = new Set(featured.map((h) => h.token));
  const ordered = holdings.filter((h) => keep.has(h.token)); // contract order
  const rest = holdings.filter((h) => !keep.has(h.token));

  const parts: AllocationPart[] = [
    ...ordered.map((h, i) => ({ id: h.token, label: h.symbol, sub: h.name, value: h.valueUsd, color: VIZ_SLOTS[i] })),
    { id: 'other', label: `Other (${rest.length})`, value: rest.reduce((a, h) => a + h.valueUsd, 0), color: VIZ_OTHER },
  ].filter((p) => p.value > 0);

  return <AllocationBar parts={parts} label="Holdings by current value" format={(v) => fmtUsd(v)} />;
}
