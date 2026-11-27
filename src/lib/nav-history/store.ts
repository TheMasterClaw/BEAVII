/**
 * Per-ITF NAV history: one point per ITF per hour at most (a later write in the same hour replaces it).
 * Backend, first configured wins (same env as agent accounts): Supabase, Upstash Redis / Vercel KV, else .data/ file.
 * On Vercel without a database, history is off: writes are skipped and reads return nothing.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface NavPoint {
  etf: string; // lowercase 0x vault
  t: number; // unix seconds, rounded down to the hour
  nav: number; // NAV per share, USD
  aum: number; // total value, USD
  supply: number; // total shares
}

const HOUR = 3600;
export const toBucket = (t: number) => Math.floor(t / HOUR) * HOUR;

interface Store {
  put(points: NavPoint[]): Promise<void>;
  range(etf: string, from: number): Promise<NavPoint[]>;
}

// ---------------------------------------------------------------- Supabase
class SupabaseStore implements Store {
  constructor(private url: string, private key: string) {}
  private req(p: string, init: RequestInit & { prefer?: string } = {}) {
    return fetch(`${this.url}/rest/v1/${p}`, {
      ...init,
      headers: {
        apikey: this.key,
        Authorization: `Bearer ${this.key}`,
        'Content-Type': 'application/json',
        ...(init.prefer ? { Prefer: init.prefer } : {}),
      },
      cache: 'no-store',
    });
  }
  async put(points: NavPoint[]) {
    if (!points.length) return;
    const rows = points.map((p) => ({ etf: p.etf, t: new Date(p.t * 1000).toISOString(), nav: p.nav, aum: p.aum, supply: p.supply }));
    const res = await this.req('etf_nav_history?on_conflict=etf,t', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: JSON.stringify(rows),
    });
    if (!res.ok) throw new Error(`nav history: ${res.status} ${await res.text()}`);
  }
  async range(etf: string, from: number) {
    const q = `etf=eq.${encodeURIComponent(etf)}&t=gte.${encodeURIComponent(new Date(from * 1000).toISOString())}&order=t.asc&limit=5000`;
    const res = await this.req(`etf_nav_history?${q}&select=etf,t,nav,aum,supply`);
    if (!res.ok) throw new Error(`nav history: ${res.status} ${await res.text()}`);
    const rows = (await res.json()) as { etf: string; t: string; nav: number; aum: number; supply: number }[];
    return rows.map((r) => ({ ...r, t: Math.floor(Date.parse(r.t) / 1000) }));
  }
}

// ---------------------------------------------------------------- Redis (Upstash REST / Vercel KV): one sorted set per ITF
class RedisStore implements Store {
  constructor(private url: string, private token: string) {}
  private async cmd<T = unknown>(...args: (string | number)[]): Promise<T> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      cache: 'no-store',
    });
    const body = (await res.json()) as { result?: T; error?: string };
    if (!res.ok || body.error) throw new Error(`nav history: ${body.error ?? res.status}`);
    return body.result as T;
  }
  private key = (etf: string) => `beavii:nav:${etf}`;
  async put(points: NavPoint[]) {
    for (const p of points) {
      await this.cmd('ZREMRANGEBYSCORE', this.key(p.etf), p.t, p.t);
      await this.cmd('ZADD', this.key(p.etf), p.t, JSON.stringify(p));
    }
  }
  async range(etf: string, from: number) {
    const raw = await this.cmd<string[]>('ZRANGEBYSCORE', this.key(etf), from, '+inf');
    return raw.map((s) => JSON.parse(s) as NavPoint);
  }
}

// ---------------------------------------------------------------- JSON file (dev)
class FileStore implements Store {
  private file = path.join(process.cwd(), '.data', 'nav-history.json');
  private queue: Promise<unknown> = Promise.resolve();
  private async read(): Promise<Record<string, NavPoint[]>> {
    try {
      return JSON.parse(await fs.readFile(this.file, 'utf8')) as Record<string, NavPoint[]>;
    } catch {
      return {};
    }
  }
  put(points: NavPoint[]) {
    const run = this.queue.then(async () => {
      const d = await this.read();
      for (const p of points) {
        const list = (d[p.etf] ??= []).filter((x) => x.t !== p.t);
        list.push(p);
        d[p.etf] = list.sort((a, b) => a.t - b.t);
      }
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.writeFile(this.file, JSON.stringify(d), { mode: 0o600 });
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
  async range(etf: string, from: number) {
    return ((await this.read())[etf] ?? []).filter((p) => p.t >= from);
  }
}

let store: Store | null | undefined;
function backend(): Store | null {
  if (store !== undefined) return store;
  const supaUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (supaUrl && supaKey) store = new SupabaseStore(supaUrl.replace(/\/$/, ''), supaKey);
  else if (url && token) store = new RedisStore(url, token);
  else if (process.env.VERCEL) store = null; // serverless disk is not persistent
  else store = new FileStore();
  return store;
}

export const navHistory = {
  enabled: () => backend() !== null,
  put: (points: NavPoint[]) => backend()?.put(points.map((p) => ({ ...p, etf: p.etf.toLowerCase(), t: toBucket(p.t) }))) ?? Promise.resolve(),
  range: (etf: string, from: number) => backend()?.range(etf.toLowerCase(), from) ?? Promise.resolve([] as NavPoint[]),
};
