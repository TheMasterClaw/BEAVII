import { NextRequest, NextResponse } from 'next/server';
import { ToolError, accountStatus, newAgentKey, sendToOwner } from '@/lib/external-agents';
import { agentStore, publicRecord } from '@/lib/agent-accounts/store';
import { agentWallet } from '@/lib/agent-accounts/wallet';
import { OwnerAuthError, verifyOwner } from '@/lib/agent-accounts/owner-auth';
import type { OwnerAction } from '@/lib/agent-accounts/owner-message';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const rec = await agentStore().get((await params).id);
  if (!rec) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(await accountStatus(rec));
}

/**
 * POST /api/agents/v1/accounts/:id { action, details, issuedAt, signature } — owner-signed management:
 *  revoke   {}                                  disable the API key (wallet and funds stay; owner can still withdraw)
 *  rotate   {}                                  issue a new key (old one stops working); re-activates a revoked agent
 *  limits   { maxTradeUsd: number | null }
 *  withdraw { asset: "cash"|"eth"|<etf>, amount: number|"all" }   send agent funds to the owner
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const b = (await req.json().catch(() => ({}))) as { action?: OwnerAction; details?: Record<string, unknown>; issuedAt?: string; signature?: string };
  const store = agentStore();
  const rec = await store.get(id);
  if (!rec) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const action = b.action;
  if (!action || !['revoke', 'rotate', 'limits', 'withdraw'].includes(action)) {
    return NextResponse.json({ error: 'action must be revoke | rotate | limits | withdraw' }, { status: 400 });
  }
  const details = b.details ?? {};
  try {
    await verifyOwner({ action, owner: rec.owner, agent: id, details, issuedAt: b.issuedAt ?? '', signature: b.signature ?? '' });
    switch (action) {
      case 'revoke': {
        const prev = rec.keyHash;
        const next = { ...rec, keyHash: '', revokedAt: Date.now() };
        await store.save(next, prev);
        return NextResponse.json({ agent: publicRecord(next) });
      }
      case 'rotate': {
        const prev = rec.keyHash;
        const { key, hash, prefix } = newAgentKey(id);
        const next = { ...rec, keyHash: hash, keyPrefix: prefix, revokedAt: null };
        await store.save(next, prev);
        return NextResponse.json({ agent: publicRecord(next), apiKey: key });
      }
      case 'limits': {
        const v = details.maxTradeUsd;
        const maxTradeUsd = v == null ? null : Number(v);
        if (maxTradeUsd !== null && !(maxTradeUsd > 0)) return NextResponse.json({ error: 'maxTradeUsd must be positive or null' }, { status: 400 });
        const next = { ...rec, limits: { ...rec.limits, maxTradeUsd } };
        await store.save(next, rec.keyHash);
        return NextResponse.json({ agent: publicRecord(next) });
      }
      case 'withdraw': {
        const amount = details.amount === 'all' ? 'all' : Number(details.amount);
        if (amount !== 'all' && !(amount > 0)) return NextResponse.json({ error: 'amount must be positive or "all"' }, { status: 400 });
        const result = await sendToOwner({ rec, wallet: agentWallet(id) }, String(details.asset ?? ''), amount);
        return NextResponse.json({ ok: true, ...result });
      }
    }
  } catch (e) {
    const status = e instanceof OwnerAuthError ? 401 : e instanceof ToolError ? e.status : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
