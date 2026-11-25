import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { accountStatus, newAgentKey } from '@/lib/external-agents';
import { agentStore, publicRecord, type AgentRecord } from '@/lib/agent-accounts/store';
import { agentWallet } from '@/lib/agent-accounts/wallet';
import { OwnerAuthError, verifyOwner } from '@/lib/agent-accounts/owner-auth';

export const dynamic = 'force-dynamic';

const MAX_AGENTS_PER_OWNER = 10;

/** GET /api/agents/v1/accounts?owner=0x..  An owner's agents with balances and permissions (all public on-chain data). */
export async function GET(req: NextRequest) {
  const owner = req.nextUrl.searchParams.get('owner') ?? '';
  if (!ethers.isAddress(owner)) return NextResponse.json({ error: 'owner must be a 0x address' }, { status: 400 });
  try {
    const recs = await agentStore().byOwner(owner);
    const agents = await Promise.all(recs.map((r) => accountStatus(r)));
    return NextResponse.json({ agents });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/**
 * POST /api/agents/v1/accounts { owner, name, maxTradeUsd?, issuedAt, signature }
 * Creates an agent account with its own wallet. The signature is the owner's over ownerMessage({action:'create'}).
 * Returns the API key ONCE.
 */
export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => ({}))) as {
    owner?: string;
    name?: string;
    maxTradeUsd?: number | null;
    issuedAt?: string;
    signature?: string;
  };
  const name = (b.name ?? '').trim();
  if (!/^[\w .-]{1,40}$/.test(name)) return NextResponse.json({ error: 'name: 1-40 letters, numbers, spaces, . _ -' }, { status: 400 });
  const maxTradeUsd = b.maxTradeUsd == null ? null : Number(b.maxTradeUsd);
  if (maxTradeUsd !== null && !(maxTradeUsd > 0)) return NextResponse.json({ error: 'maxTradeUsd must be positive or null' }, { status: 400 });
  try {
    await verifyOwner({
      action: 'create',
      owner: b.owner ?? '',
      agent: name,
      details: { maxTradeUsd },
      issuedAt: b.issuedAt ?? '',
      signature: b.signature ?? '',
    });
    const owner = b.owner!.toLowerCase();
    const store = agentStore();
    if ((await store.byOwner(owner)).filter((a) => !a.revokedAt).length >= MAX_AGENTS_PER_OWNER) {
      return NextResponse.json({ error: `at most ${MAX_AGENTS_PER_OWNER} active agents per owner` }, { status: 400 });
    }
    const id = randomBytes(8).toString('hex');
    const { key, hash, prefix } = newAgentKey(id);
    const rec: AgentRecord = {
      id,
      owner,
      name,
      address: agentWallet(id).address,
      keyHash: hash,
      keyPrefix: prefix,
      limits: { maxTradeUsd },
      createdAt: Date.now(),
      revokedAt: null,
    };
    await store.save(rec);
    return NextResponse.json({ agent: publicRecord(rec), apiKey: key }, { status: 201 });
  } catch (e) {
    const status = e instanceof OwnerAuthError ? 401 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
