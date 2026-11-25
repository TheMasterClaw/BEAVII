/**
 * Wallet <-> X account links. One X account per wallet and one wallet per X account: a new link replaces older ones
 * on both sides. Holds no tokens; X access tokens are revoked right after the profile is read.
 * Backend, first configured wins (same env as agent accounts): Supabase, Upstash Redis / Vercel KV, else .data/ file.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

export type XLink = {
  address: string; // lowercase 0x
  xId: string; // X's stable numeric user id
  username: string; // handle at verification time, without @
  name: string;
  verifiedAt: number;
};

interface Store {
  byAddress(address: string): Promise<XLink | null>;
  byXId(xId: string): Promise<XLink | null>;
  put(link: XLink): Promise<void>;
  remove(address: string): Promise<boolean>;
}

/** Replace any links that share this wallet or this X account, then save. */
async function replaceLink(s: Store, link: XLink) {
  const old = await s.byXId(link.xId);
  if (old && old.address !== link.address) await s.remove(old.address);
  await s.put(link);
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
  private async one(query: string) {
    const res = await this.req(`x_links?${query}&select=data`);
    if (!res.ok) throw new Error(`x store: ${res.status} ${await res.text()}`);
    return ((await res.json()) as { data: XLink }[])[0]?.data ?? null;
  }
  byAddress(a: string) {
    return this.one(`address=eq.${encodeURIComponent(a.toLowerCase())}`);
  }
  byXId(id: string) {
    return this.one(`x_id=eq.${encodeURIComponent(id)}`);
  }
  async put(l: XLink) {
    const res = await this.req('x_links?on_conflict=address', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: JSON.stringify({ address: l.address, x_id: l.xId, data: l, verified_at: new Date(l.verifiedAt).toISOString() }),
    });
    if (!res.ok) throw new Error(`x store: ${res.status} ${await res.text()}`);
  }
  async remove(a: string) {
    const res = await this.req(`x_links?address=eq.${encodeURIComponent(a.toLowerCase())}`, { method: 'DELETE', prefer: 'return=representation' });
    if (!res.ok) throw new Error(`x store: ${res.status} ${await res.text()}`);
    return ((await res.json()) as unknown[]).length > 0;
  }
}

// ---------------------------------------------------------------- Redis (Upstash REST / Vercel KV)
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
    if (!res.ok || body.error) throw new Error(`x store: ${body.error ?? res.status}`);
    return body.result as T;
  }
  async byAddress(a: string) {
    const raw = await this.cmd<string | null>('GET', `beavii:xlink:${a.toLowerCase()}`);
    return raw ? (JSON.parse(raw) as XLink) : null;
  }
  async byXId(id: string) {
    const a = await this.cmd<string | null>('GET', `beavii:xid:${id}`);
    return a ? this.byAddress(a) : null;
  }
  async put(l: XLink) {
    const prev = await this.byAddress(l.address);
    if (prev && prev.xId !== l.xId) await this.cmd('DEL', `beavii:xid:${prev.xId}`);
    await this.cmd('SET', `beavii:xlink:${l.address}`, JSON.stringify(l));
    await this.cmd('SET', `beavii:xid:${l.xId}`, l.address);
  }
  async remove(a: string) {
    const prev = await this.byAddress(a);
    if (!prev) return false;
    await this.cmd('DEL', `beavii:xlink:${prev.address}`, `beavii:xid:${prev.xId}`);
    return true;
  }
}

// ---------------------------------------------------------------- JSON file (dev)
class FileStore implements Store {
  private file = path.join(process.cwd(), '.data', 'x-links.json');
  private queue: Promise<unknown> = Promise.resolve();
  private async read(): Promise<Record<string, XLink>> {
    try {
      return JSON.parse(await fs.readFile(this.file, 'utf8')) as Record<string, XLink>;
    } catch {
      return {};
    }
  }
  private update<T>(fn: (d: Record<string, XLink>) => T): Promise<T> {
    const run = this.queue.then(async () => {
      const d = await this.read();
      const out = fn(d);
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.writeFile(this.file, JSON.stringify(d, null, 2), { mode: 0o600 });
      return out;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
  async byAddress(a: string) {
    return (await this.read())[a.toLowerCase()] ?? null;
  }
  async byXId(id: string) {
    return Object.values(await this.read()).find((l) => l.xId === id) ?? null;
  }
  put(l: XLink) {
    return this.update((d) => {
      d[l.address] = l;
    });
  }
  remove(a: string) {
    return this.update((d) => {
      const had = Boolean(d[a.toLowerCase()]);
      delete d[a.toLowerCase()];
      return had;
    });
  }
}

let store: Store | null = null;
function backend(): Store {
  if (store) return store;
  const supaUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (supaUrl && supaKey) store = new SupabaseStore(supaUrl.replace(/\/$/, ''), supaKey);
  else if (url && token) store = new RedisStore(url, token);
  else if (process.env.VERCEL) throw new Error('X verification needs a database on Vercel: set SUPABASE_* or Upstash Redis');
  else store = new FileStore();
  return store;
}

export const xLinks = {
  byAddress: (a: string) => backend().byAddress(a),
  save: (l: XLink) => replaceLink(backend(), l),
  remove: (a: string) => backend().remove(a),
};
