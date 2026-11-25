'use client';

import { useCallback, useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { Bot, Check, Copy, KeyRound, RefreshCw, ShieldCheck, ShieldOff, Wallet } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { CASH_TOKEN, explorerUrl } from '@/config/base-sepolia';
import { B20_ABI, STOCK_VAULT_ABI } from '@/lib/stock-vault';
import { ownerMessage, type OwnerAction } from '@/lib/agent-accounts/owner-message';
import { txErrorMessage, useInjectedWallet } from '@/hooks/use-injected-wallet';

type EtfRow = {
  address: string;
  name: string;
  symbol: string;
  navPerShare: number;
  agentShares: number;
  agentValueUsd: number;
  ownerShares: number;
  ownerSharesAllowedToSell: number;
  ownerIsManager: boolean;
  agentIsManager: boolean;
  canRebalance: boolean;
};
type AgentStatus = {
  account: { id: string; name: string; address: string; keyPrefix: string; active: boolean; createdAt: number; limits: { maxTradeUsd: number | null } };
  wallet: { address: string; eth: number; cash: number; cashSymbol: string };
  owner: { address: string; cash: number; cashAllowedToSpend: number };
  etfs: EtfRow[];
};

const fmt = (n: number, d = 2) => n.toLocaleString('en-US', { maximumFractionDigits: d });
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function AgentsPage() {
  const { account, connect, getSigner } = useInjectedWallet();
  const [agents, setAgents] = useState<AgentStatus[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<{ name: string; key: string } | null>(null);
  const [name, setName] = useState('');
  const [maxTrade, setMaxTrade] = useState('');

  const load = useCallback(async () => {
    if (!account) return setAgents(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/agents/v1/accounts?owner=${account}`, { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setAgents(body.agents);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => {
    load();
  }, [load]);

  /** Run a wallet action with a busy label, then refresh. */
  const run = async (label: string, fn: () => Promise<string | void>) => {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      const msg = await fn();
      if (msg) setNotice(msg);
      await load();
    } catch (e) {
      setError(txErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const signOwner = async (action: OwnerAction, agent: string, details: Record<string, unknown>) => {
    const signer = await getSigner();
    const issuedAt = new Date().toISOString();
    const signature = await signer.signMessage(ownerMessage({ action, owner: account, agent, details, issuedAt }));
    return { issuedAt, signature };
  };

  const ownerAction = async (id: string, action: OwnerAction, details: Record<string, unknown> = {}) => {
    const sig = await signOwner(action, id, details);
    const res = await fetch(`/api/agents/v1/accounts/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, details, ...sig }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error);
    return body;
  };

  const create = () =>
    run('create', async () => {
      const maxTradeUsd = maxTrade ? Number(maxTrade) : null;
      const sig = await signOwner('create', name.trim(), { maxTradeUsd });
      const res = await fetch('/api/agents/v1/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner: account, name: name.trim(), maxTradeUsd, ...sig }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setNewKey({ name: body.agent.name, key: body.apiKey });
      setName('');
      setMaxTrade('');
    });

  const tx = async (p: Promise<ethers.ContractTransactionResponse | ethers.TransactionResponse>) => {
    const t = await p;
    await t.wait();
    return t.hash;
  };
  const cashWith = async () => new ethers.Contract(CASH_TOKEN.address, B20_ABI, await getSigner());
  const vaultWith = async (etf: string) => new ethers.Contract(etf, STOCK_VAULT_ABI, await getSigner());

  const actions = {
    fundCash: (a: AgentStatus, amount: string) =>
      run(`fund-${a.account.id}`, async () => {
        await tx((await cashWith()).transfer(a.wallet.address, ethers.parseUnits(amount, CASH_TOKEN.decimals)));
        return `Sent ${amount} ${CASH_TOKEN.symbol} to ${a.account.name}.`;
      }),
    fundGas: (a: AgentStatus) =>
      run(`gas-${a.account.id}`, async () => {
        await tx((await getSigner()).sendTransaction({ to: a.wallet.address, value: ethers.parseEther('0.002') }));
        return `Sent 0.002 ETH for gas to ${a.account.name}.`;
      }),
    allowSpend: (a: AgentStatus, amount: string) =>
      run(`spend-${a.account.id}`, async () => {
        await tx((await cashWith()).approve(a.wallet.address, ethers.parseUnits(amount || '0', CASH_TOKEN.decimals)));
        return Number(amount) > 0 ? `${a.account.name} may now spend up to ${amount} ${CASH_TOKEN.symbol} of yours.` : 'Spending permission revoked.';
      }),
    allowSell: (a: AgentStatus, etf: EtfRow, shares: string) =>
      run(`sell-${a.account.id}-${etf.address}`, async () => {
        await tx((await vaultWith(etf.address)).approve(a.wallet.address, ethers.parseEther(shares || '0')));
        return Number(shares) > 0 ? `${a.account.name} may now sell up to ${shares} ${etf.symbol} shares of yours.` : `Sell permission on ${etf.symbol} revoked.`;
      }),
    allowRebalance: (a: AgentStatus, etf: EtfRow, on: boolean) =>
      run(`rebal-${a.account.id}-${etf.address}`, async () => {
        await tx((await vaultWith(etf.address)).setAgentAuthorization(a.wallet.address, on));
        return on ? `${a.account.name} may now rebalance ${etf.symbol}.` : `${a.account.name} can no longer rebalance ${etf.symbol}.`;
      }),
    withdraw: (a: AgentStatus, asset: string, label: string) =>
      run(`wd-${a.account.id}-${asset}`, async () => {
        const r = await ownerAction(a.account.id, 'withdraw', { asset, amount: 'all' });
        return `Withdrew all ${label} from ${a.account.name} to your wallet (tx ${short(r.txHash)}).`;
      }),
    rotate: (a: AgentStatus) =>
      run(`rotate-${a.account.id}`, async () => {
        const r = await ownerAction(a.account.id, 'rotate');
        setNewKey({ name: a.account.name, key: r.apiKey });
      }),
    revoke: (a: AgentStatus) =>
      run(`revoke-${a.account.id}`, async () => {
        await ownerAction(a.account.id, 'revoke');
        return `${a.account.name}'s key is revoked. Its wallet and funds stay yours to withdraw.`;
      }),
    setLimit: (a: AgentStatus, v: string) =>
      run(`limit-${a.account.id}`, async () => {
        await ownerAction(a.account.id, 'limits', { maxTradeUsd: v ? Number(v) : null });
        return v ? `Trade limit set to $${v}.` : 'Trade limit removed.';
      }),
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Agents</h1>
          <p className="mt-1 max-w-2xl text-muted-foreground">
            Connect your own AI agent (Hermes, OpenClaw, a Grok bot…). Each agent gets its own wallet. It can trade what you send it,
            or your funds only up to what you allow on-chain, and anything it buys or sells with your funds comes straight back to you.
          </p>
        </div>
        {account && (
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`mr-1 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        )}
      </div>

      {error && <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>}
      {notice && <p className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600">{notice}</p>}

      {newKey && <KeyReveal name={newKey.name} apiKey={newKey.key} onClose={() => setNewKey(null)} />}

      {!account ? (
        <Card>
          <CardHeader>
            <CardTitle>Log in to manage agents</CardTitle>
            <CardDescription>Your wallet owns your agents: it signs to create them, revoke keys and withdraw their funds.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={connect}>
              <Wallet className="mr-1 h-4 w-4" /> Connect wallet
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot className="h-5 w-5" /> New agent
              </CardTitle>
              <CardDescription>You sign a message (no gas). You get an API key once; paste it into your agent.</CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="flex flex-col gap-3 sm:flex-row sm:items-end"
                onSubmit={(e) => {
                  e.preventDefault();
                  create();
                }}
              >
                <div className="flex-1 space-y-1">
                  <Label htmlFor="agent-name">Name</Label>
                  <Input id="agent-name" placeholder="hermes-trader" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required />
                </div>
                <div className="space-y-1 sm:w-48">
                  <Label htmlFor="agent-limit">Max per trade (USD)</Label>
                  <Input id="agent-limit" type="number" min="1" step="any" placeholder="No limit" value={maxTrade} onChange={(e) => setMaxTrade(e.target.value)} />
                </div>
                <Button type="submit" disabled={!name.trim() || busy === 'create'}>
                  {busy === 'create' ? 'Signing…' : 'Create agent'}
                </Button>
              </form>
            </CardContent>
          </Card>

          {agents && agents.length === 0 && <p className="text-sm text-muted-foreground">No agents yet.</p>}
          <div className="grid gap-4 xl:grid-cols-2">
            {(agents ?? []).map((a) => (
              <AgentCard key={a.account.id} a={a} busy={busy} actions={actions} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

type Actions = {
  fundCash: (a: AgentStatus, amount: string) => void;
  fundGas: (a: AgentStatus) => void;
  allowSpend: (a: AgentStatus, amount: string) => void;
  allowSell: (a: AgentStatus, etf: EtfRow, shares: string) => void;
  allowRebalance: (a: AgentStatus, etf: EtfRow, on: boolean) => void;
  withdraw: (a: AgentStatus, asset: string, label: string) => void;
  rotate: (a: AgentStatus) => void;
  revoke: (a: AgentStatus) => void;
  setLimit: (a: AgentStatus, v: string) => void;
};

function AgentCard({ a, busy, actions }: { a: AgentStatus; busy: string | null; actions: Actions }) {
  const id = a.account.id;
  const [fund, setFund] = useState('100');
  const [spend, setSpend] = useState(a.owner.cashAllowedToSpend ? String(a.owner.cashAllowedToSpend) : '100');
  const [limit, setLimit] = useState(a.account.limits.maxTradeUsd ? String(a.account.limits.maxTradeUsd) : '');
  const relevant = a.etfs.filter((e) => e.ownerShares > 0 || e.ownerIsManager || e.agentShares > 0 || e.ownerSharesAllowedToSell > 0);
  const is = (k: string) => busy === k;

  return (
    <Card className={a.account.active ? '' : 'opacity-75'}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="truncate">{a.account.name}</CardTitle>
            <CardDescription className="flex items-center gap-1 font-mono">
              <a href={explorerUrl(a.wallet.address)} target="_blank" rel="noreferrer" className="hover:underline">
                {short(a.wallet.address)}
              </a>
              <CopyButton value={a.wallet.address} label="Copy agent address" />
            </CardDescription>
          </div>
          <Badge variant={a.account.active ? 'default' : 'secondary'}>{a.account.active ? 'Active' : 'Key revoked'}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        <dl className="grid grid-cols-3 gap-3">
          <Kv k="Agent cash" v={`${fmt(a.wallet.cash)} ${a.wallet.cashSymbol}`} />
          <Kv k="Gas" v={`${fmt(a.wallet.eth, 5)} ETH`} />
          <Kv k="Can spend of yours" v={`${fmt(a.owner.cashAllowedToSpend)} ${a.wallet.cashSymbol}`} />
        </dl>

        <Section title="Fund its own account" hint="Funds you send belong to the agent's wallet; you can withdraw them any time.">
          <div className="flex flex-wrap gap-2">
            <Input className="w-28" type="number" min="0" step="any" value={fund} onChange={(e) => setFund(e.target.value)} aria-label="Amount of tUSDC to send" />
            <Button size="sm" onClick={() => actions.fundCash(a, fund)} disabled={!Number(fund) || is(`fund-${id}`)}>
              {is(`fund-${id}`) ? 'Sending…' : `Send ${CASH_TOKEN.symbol}`}
            </Button>
            <Button size="sm" variant="outline" onClick={() => actions.fundGas(a)} disabled={is(`gas-${id}`)}>
              Send 0.002 ETH gas
            </Button>
          </div>
        </Section>

        <Section title="Let it spend your cash" hint={`It can buy ITFs with up to this much of your ${CASH_TOKEN.symbol}; the shares come to you.`}>
          <div className="flex flex-wrap gap-2">
            <Input className="w-28" type="number" min="0" step="any" value={spend} onChange={(e) => setSpend(e.target.value)} aria-label="Spending allowance" />
            <Button size="sm" variant="outline" onClick={() => actions.allowSpend(a, spend)} disabled={is(`spend-${id}`)}>
              <ShieldCheck className="mr-1 h-4 w-4" /> Allow
            </Button>
            {a.owner.cashAllowedToSpend > 0 && (
              <Button size="sm" variant="ghost" onClick={() => actions.allowSpend(a, '0')} disabled={is(`spend-${id}`)}>
                <ShieldOff className="mr-1 h-4 w-4" /> Revoke
              </Button>
            )}
          </div>
        </Section>

        {relevant.length > 0 && (
          <Section title="ITF permissions" hint="Sell: it may redeem up to this many of your shares (cash comes to you). Rebalance: ITFs you manage.">
            <ul className="divide-y rounded-md border">
              {relevant.map((e) => (
                <EtfPermissionRow key={e.address} a={a} e={e} busy={busy} actions={actions} />
              ))}
            </ul>
          </Section>
        )}

        <Section title="Limits and key">
          <div className="flex flex-wrap items-center gap-2">
            <Input className="w-28" type="number" min="1" step="any" placeholder="No limit" value={limit} onChange={(e) => setLimit(e.target.value)} aria-label="Max per trade in USD" />
            <Button size="sm" variant="outline" onClick={() => actions.setLimit(a, limit)} disabled={is(`limit-${id}`)}>
              Set max / trade
            </Button>
            <span className="ml-auto font-mono text-xs text-muted-foreground">{a.account.keyPrefix}…</span>
            <Button size="sm" variant="outline" onClick={() => actions.rotate(a)} disabled={is(`rotate-${id}`)}>
              <KeyRound className="mr-1 h-4 w-4" /> {a.account.active ? 'New key' : 'Re-activate'}
            </Button>
            {a.account.active && (
              <Button size="sm" variant="destructive" onClick={() => actions.revoke(a)} disabled={is(`revoke-${id}`)}>
                Revoke key
              </Button>
            )}
          </div>
        </Section>

        {(a.wallet.cash > 0 || a.etfs.some((e) => e.agentShares > 0) || a.wallet.eth > 0.0002) && (
          <Section title="Withdraw to your wallet">
            <div className="flex flex-wrap gap-2">
              {a.wallet.cash > 0 && (
                <Button size="sm" variant="outline" onClick={() => actions.withdraw(a, 'cash', CASH_TOKEN.symbol)} disabled={is(`wd-${id}-cash`)}>
                  All {CASH_TOKEN.symbol}
                </Button>
              )}
              {a.etfs
                .filter((e) => e.agentShares > 0)
                .map((e) => (
                  <Button key={e.address} size="sm" variant="outline" onClick={() => actions.withdraw(a, e.address, e.symbol)} disabled={is(`wd-${id}-${e.address}`)}>
                    All {e.symbol} ({fmt(e.agentShares, 4)})
                  </Button>
                ))}
              {a.wallet.eth > 0.0002 && (
                <Button size="sm" variant="ghost" onClick={() => actions.withdraw(a, 'eth', 'ETH')} disabled={is(`wd-${id}-eth`)}>
                  ETH
                </Button>
              )}
            </div>
          </Section>
        )}
      </CardContent>
    </Card>
  );
}

function EtfPermissionRow({ a, e, busy, actions }: { a: AgentStatus; e: EtfRow; busy: string | null; actions: Actions }) {
  const [shares, setShares] = useState(e.ownerSharesAllowedToSell ? String(e.ownerSharesAllowedToSell) : String(e.ownerShares || ''));
  const sellKey = `sell-${a.account.id}-${e.address}`;
  const rebalKey = `rebal-${a.account.id}-${e.address}`;
  return (
    <li className="space-y-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">
          {e.symbol} <span className="font-normal text-muted-foreground">{e.name}</span>
        </span>
        <span className="text-xs text-muted-foreground">
          You hold {fmt(e.ownerShares, 4)} · agent holds {fmt(e.agentShares, 4)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {e.ownerShares > 0 || e.ownerSharesAllowedToSell > 0 ? (
          <>
            <Input className="w-28" type="number" min="0" step="any" value={shares} onChange={(ev) => setShares(ev.target.value)} aria-label={`Shares of ${e.symbol} the agent may sell`} />
            <Button size="sm" variant="outline" onClick={() => actions.allowSell(a, e, shares)} disabled={busy === sellKey}>
              Allow selling
            </Button>
            {e.ownerSharesAllowedToSell > 0 && (
              <Button size="sm" variant="ghost" onClick={() => actions.allowSell(a, e, '0')} disabled={busy === sellKey}>
                Revoke ({fmt(e.ownerSharesAllowedToSell, 4)})
              </Button>
            )}
          </>
        ) : null}
        {e.ownerIsManager && (
          <Button size="sm" variant={e.canRebalance ? 'ghost' : 'outline'} className="ml-auto" onClick={() => actions.allowRebalance(a, e, !e.canRebalance)} disabled={busy === rebalKey}>
            {e.canRebalance ? 'Stop rebalancing' : 'Allow rebalancing'}
          </Button>
        )}
      </div>
    </li>
  );
}

function KeyReveal({ name, apiKey, onClose }: { name: string; apiKey: string; onClose: () => void }) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const mcp = `mcp_servers:\n  beavii:\n    url: ${origin}/api/agents/v1/mcp\n    headers: { Authorization: "Bearer ${apiKey}" }`;
  return (
    <Card className="border-amber-500/50">
      <CardHeader>
        <CardTitle>API key for {name}</CardTitle>
        <CardDescription>Copy it now: it is not shown again. Anyone with this key can trade this agent&apos;s account.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center gap-2">
          <code className="flex-1 break-all rounded bg-muted px-2 py-1 font-mono text-xs">{apiKey}</code>
          <CopyButton value={apiKey} label="Copy API key" />
        </div>
        <p className="text-muted-foreground">MCP (Hermes, OpenClaw, Claude, Cursor): the exact config keys depend on the client.</p>
        <pre className="overflow-x-auto rounded bg-muted p-2 font-mono text-xs">{mcp}</pre>
        <p className="text-muted-foreground">
          Function-calling bots (Grok, OpenAI-style): load tools from <code>{origin}/api/agents/v1</code> and call{' '}
          <code>POST /api/agents/v1/tools/&lt;name&gt;</code>. OpenAPI: <code>/api/agents/v1/openapi.json</code>.
        </p>
        <Button size="sm" onClick={onClose}>
          I saved it
        </Button>
      </CardContent>
    </Card>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      className="rounded p-1 text-muted-foreground hover:text-foreground"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="font-medium">{title}</h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{k}</dt>
      <dd className="font-medium tabular-nums">{v}</dd>
    </div>
  );
}
