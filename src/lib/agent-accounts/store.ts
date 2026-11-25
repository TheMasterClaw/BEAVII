/**
 * Registry of agent accounts. Holds no secrets: API keys are stored as SHA-256 hashes, and agent wallet keys are
 * derived on demand from AGENT_WALLET_SEED (see wallet.ts).
 * Backend, first configured wins: Supabase (PostgREST, tables from supabase/migrations), Upstash Redis / Vercel KV
 * over REST, else a JSON file in .data/ (local dev, self-hosting).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

export type AgentLimits = { maxTradeUsd: number | null };

export type AgentRecord = {
  id: string;
  owner: string; // lowercase 0x address of the user who created it
  name: string;
  address: string; // the agent's own wallet
  keyHash: string; // sha256 hex of the current API key ('' when revoked)
  keyPrefix: string; // first chars of the key, to help users tell keys apart
  limits: AgentLimits;
  createdAt: number;
  revokedAt: number | null;
};

interface Store {
  get(id: string): Promise<AgentRecord | null>;
  byKeyHash(hash: string): Promise<AgentRecord | null>;
  byOwner(owner: string): Promise<AgentRecord[]>;
  /** Every agent record, oldest first. Admin-only (full scan). */
  all(): Promise<AgentRecord[]>;
  save(rec: AgentRecord, previousKeyHash?: string): Promise<void>;
  /** Returns false if this value was already used (signature replay protection). */
  claimOnce(value: string, ttlSec: number): Promise<boolean>;
}

// ---------------------------------------------------------------- Supabase (PostgREST, service role)
class SupabaseStore implements Store {
  constructor(private url: string, private key: string) {}

  private async req(path: string, init: RequestInit & { prefer?: string } = {}) {
    const res = await fetch(`${this.url}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: this.key,
        Authorization: `Bearer ${this.key}`,
        'Content-Type': 'application/json',
        ...(init.prefer ? { Prefer: init.prefer } : {}),
      },
      cache: 'no-store',
    });
    return res;
  }
  private async rows(path: string): Promise<AgentRecord[]> {
    const res = await this.req(path);
    if (!res.ok) throw new Error(`agent store: ${res.status} ${await res.text()}`);
    return ((await res.json()) as { data: AgentRecord }[]).map((r) => r.data);
  }

  async get(id: string) {
    return (await this.rows(`agent_accounts?id=eq.${encodeURIComponent(id)}&select=data`))[0] ?? null;
  }
  async byKeyHash(hash: string) {
    return (await this.rows(`agent_accounts?key_hash=eq.${encodeURIComponent(hash)}&select=data`))[0] ?? null;
  }
  async byOwner(owner: string) {
    return this.rows(`agent_accounts?owner=eq.${encodeURIComponent(owner.toLowerCase())}&select=data&order=created_at.asc`);
  }
  async all() {
    return this.rows('agent_accounts?select=data&order=created_at.asc');
  }
  async save(rec: AgentRecord) {
    const res = await this.req('agent_accounts?on_conflict=id', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: JSON.stringify({ id: rec.id, owner: rec.owner, key_hash: rec.keyHash || null, data: rec, created_at: new Date(rec.createdAt).toISOString() }),
    });
    if (!res.ok) throw new Error(`agent store: ${res.status} ${await res.text()}`);
  }
  async claimOnce(value: string, ttlSec: number) {
    const now = new Date().toISOString();
    await this.req(`agent_once?expires_at=lt.${encodeURIComponent(now)}`, { method: 'DELETE', prefer: 'return=minimal' });
    const res = await this.req('agent_once', {
      method: 'POST',
      prefer: 'return=minimal',
      body: JSON.stringify({ value, expires_at: new Date(Date.now() + ttlSec * 1000).toISOString() }),
    });
    if (res.status === 409) return false;
    if (!res.ok) throw new Error(`agent store: ${res.status} ${await res.text()}`);
    return true;
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
    if (!res.ok || body.error) throw new Error(`agent store: ${body.error ?? res.status}`);
    return body.result as T;
  }

  async get(id: string) {
    const raw = await this.cmd<string | null>('GET', `beavii:agent:${id}`);
    return raw ? (JSON.parse(raw) as AgentRecord) : null;
  }
  async byKeyHash(hash: string) {
    const id = await this.cmd<string | null>('GET', `beavii:agentkey:${hash}`);
    return id ? this.get(id) : null;
  }
  async byOwner(owner: string) {
    const ids = await this.cmd<string[]>('SMEMBERS', `beavii:owner:${owner.toLowerCase()}`);
    const recs = await Promise.all(ids.map((id) => this.get(id)));
    return recs.filter((r): r is AgentRecord => Boolean(r)).sort((a, b) => a.createdAt - b.createdAt);
  }
  async all() {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.cmd<[string, string[]]>('SCAN', cursor, 'MATCH', 'beavii:agent:*', 'COUNT', 1000);
      keys.push(...batch);
      cursor = next;
    } while (cursor !== '0');
    const recs: AgentRecord[] = [];
    for (let i = 0; i < keys.length; i += 500) {
      const raws = await this.cmd<(string | null)[]>('MGET', ...keys.slice(i, i + 500));
      for (const raw of raws) if (raw) recs.push(JSON.parse(raw) as AgentRecord);
    }
    return recs.sort((a, b) => a.createdAt - b.createdAt);
  }
  async save(rec: AgentRecord, previousKeyHash?: string) {
    await this.cmd('SET', `beavii:agent:${rec.id}`, JSON.stringify(rec));
    await this.cmd('SADD', `beavii:owner:${rec.owner}`, rec.id);
    if (previousKeyHash && previousKeyHash !== rec.keyHash) await this.cmd('DEL', `beavii:agentkey:${previousKeyHash}`);
    if (rec.keyHash) await this.cmd('SET', `beavii:agentkey:${rec.keyHash}`, rec.id);
  }
  async claimOnce(value: string, ttlSec: number) {
    return (await this.cmd<string | null>('SET', `beavii:once:${value}`, '1', 'NX', 'EX', ttlSec)) === 'OK';
  }
}

// ---------------------------------------------------------------- JSON file (dev)
type FileData = { agents: Record<string, AgentRecord>; once: Record<string, number> };

class FileStore implements Store {
  private file = path.join(process.cwd(), '.data', 'agents.json');
  private queue: Promise<unknown> = Promise.resolve();

  private async read(): Promise<FileData> {
    try {
      return JSON.parse(await fs.readFile(this.file, 'utf8')) as FileData;
    } catch {
      return { agents: {}, once: {} };
    }
  }
  /** Serialize read-modify-write so concurrent requests in one process don't clobber each other. */
  private update<T>(fn: (d: FileData) => T): Promise<T> {
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

  async get(id: string) {
    return (await this.read()).agents[id] ?? null;
  }
  async byKeyHash(hash: string) {
    return Object.values((await this.read()).agents).find((a) => a.keyHash === hash) ?? null;
  }
  async byOwner(owner: string) {
    const o = owner.toLowerCase();
    return Object.values((await this.read()).agents).filter((a) => a.owner === o).sort((a, b) => a.createdAt - b.createdAt);
  }
  async all() {
    return Object.values((await this.read()).agents).sort((a, b) => a.createdAt - b.createdAt);
  }
  async save(rec: AgentRecord) {
    await this.update((d) => {
      d.agents[rec.id] = rec;
    });
  }
  async claimOnce(value: string, ttlSec: number) {
    return this.update((d) => {
      const now = Date.now();
      for (const [k, exp] of Object.entries(d.once)) if (exp < now) delete d.once[k];
      if (d.once[value]) return false;
      d.once[value] = now + ttlSec * 1000;
      return true;
    });
  }
}

let store: Store | null = null;

/** Which backend agentStore() uses, without constructing it. */
export function agentStoreBackend(): 'supabase' | 'redis' | 'file' | 'unconfigured' {
  if ((process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) && process.env.SUPABASE_SERVICE_ROLE_KEY) return 'supabase';
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) return 'redis';
  return process.env.VERCEL ? 'unconfigured' : 'file';
}

export function agentStore(): Store {
  if (store) return store;
  const supaUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (supaUrl && supaKey) store = new SupabaseStore(supaUrl.replace(/\/$/, ''), supaKey);
  else if (url && token) store = new RedisStore(url, token);
  else if (process.env.VERCEL) {
    throw new Error('Agent accounts need a database on Vercel: set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or Upstash Redis)');
  } else store = new FileStore();
  return store;
}

/** Public view of a record (never includes the key hash). */
export function publicRecord(r: AgentRecord) {
  const { keyHash, ...rest } = r;
  return { ...rest, active: Boolean(keyHash) && !r.revokedAt };
}
