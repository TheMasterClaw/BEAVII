/**
 * Writes NAV history. NAV only moves when the oracle prices sync, so one snapshot per ITF after each sync
 * captures the full curve. ITFs with no history yet are backfilled with one point per day read from chain
 * state at past blocks (the Base Sepolia RPC serves historical eth_call).
 */
import { ethers } from 'ethers';
import { STOCK_VAULT_ABI, getBaseSepoliaProvider } from '@/lib/stock-vault';
import { listEtfs } from '@/lib/etf';
import { navHistory, type NavPoint } from './store';

const DAY = 86_400;
const BLOCK_TIME = 2; // seconds; fixed on Base (OP Stack)
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const mcIface = new ethers.Interface([
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) view returns ((bool success, bytes returnData)[])',
]);
const vaultIface = new ethers.Interface(STOCK_VAULT_ABI);
const n18 = (x: bigint) => Number(ethers.formatEther(x));
/** A vault holding only its locked "dead shares" has no investors, and its NAV per share is meaningless. */
const MIN_SUPPLY = 1e-6;

/** NAV, AUM and supply of one vault as of a past block, or null if it did not exist / reverted then. */
async function readAt(etf: string, blockTag: number): Promise<Omit<NavPoint, 't'> | null> {
  const fns = ['getNetAssetValue', 'getTotalValue', 'totalSupply'] as const;
  const data = mcIface.encodeFunctionData('aggregate3', [
    fns.map((fn) => ({ target: etf, allowFailure: true, callData: vaultIface.encodeFunctionData(fn) })),
  ]);
  const raw = await getBaseSepoliaProvider().call({ to: MULTICALL3, data, blockTag });
  const [res] = mcIface.decodeFunctionResult('aggregate3', raw) as unknown as [{ success: boolean; returnData: string }[]];
  if (res.some((r) => !r.success || r.returnData === '0x')) return null;
  const [nav, aum, supply] = res.map((r, i) => n18(vaultIface.decodeFunctionResult(fns[i], r.returnData)[0] as bigint));
  return supply >= MIN_SUPPLY ? { etf: etf.toLowerCase(), nav, aum, supply } : null;
}

/** One point per day (00:00 UTC) between `from` and `to`, newest first, until `deadline` (ms). */
async function backfill(etf: string, from: number, to: number, deadline: number): Promise<NavPoint[]> {
  const provider = getBaseSepoliaProvider();
  const head = await provider.getBlock('latest');
  if (!head) return [];
  const days: number[] = [];
  for (let t = Math.floor(to / DAY) * DAY; t > from; t -= DAY) days.push(t);

  const out: NavPoint[] = [];
  for (let i = 0; i < days.length && Date.now() < deadline; i += 5) {
    // 5 at a time keeps well under the public RPC's ~25 req/s
    const batch = await Promise.allSettled(
      days.slice(i, i + 5).map(async (t) => {
        const block = head.number - Math.ceil((head.timestamp - t) / BLOCK_TIME);
        const p = block > 0 ? await readAt(etf, block) : null;
        return p && { ...p, t };
      }),
    );
    for (const r of batch) if (r.status === 'fulfilled' && r.value) out.push(r.value);
  }
  return out;
}

/**
 * Snapshot every ITF now, then backfill daily history for ITFs that have none (within a time budget, so the
 * cron stays fast; anything left is filled on the next sync). No-op when no history backend is configured.
 */
export async function recordNavSnapshots({ backfillDays = 180, budgetMs = 20_000 } = {}) {
  if (!navHistory.enabled()) return { enabled: false, recorded: 0, backfilled: 0 };
  const deadline = Date.now() + budgetMs;
  const now = Math.floor(Date.now() / 1000);
  const etfs = await listEtfs();
  const live = etfs.filter((e) => e.totalShares >= MIN_SUPPLY);
  await navHistory.put(live.map((e) => ({ etf: e.address, t: now, nav: e.navPerShare, aum: e.totalValueUsd, supply: e.totalShares })));

  let backfilled = 0;
  for (const e of live) {
    if (backfillDays <= 0 || Date.now() >= deadline) break;
    const have = await navHistory.range(e.address, 0);
    const oldest = have[0]?.t ?? now;
    const start = Math.max(e.createdAt, now - backfillDays * DAY);
    if (Math.floor((oldest - 1) / DAY) * DAY <= start) continue; // no midnight left between creation and the oldest point
    const points = await backfill(e.address, start, oldest - 1, deadline);
    await navHistory.put(points);
    backfilled += points.length;
  }
  return { enabled: true, recorded: live.length, backfilled };
}
