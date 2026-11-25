import { notFound } from 'next/navigation';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { explorerUrl } from '@/config/base-sepolia';
import { adminEnabled, isAdminSession } from '@/lib/admin/auth';
import { collectAdminSnapshot, type Status } from '@/lib/admin/data';
import { LoginForm, RefreshButton, SignOutButton, WeeklyBars } from './admin-client';
import { AgentsTable, EtfsTable, UsersTable } from './tables';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const usd = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: n >= 1000 ? 0 : 2 });

const STATUS: Record<Status, { icon: typeof CheckCircle2; label: string; cls: string }> = {
  ok: { icon: CheckCircle2, label: 'OK', cls: 'text-green-600 dark:text-green-400' },
  warn: { icon: AlertTriangle, label: 'Warning', cls: 'text-amber-600 dark:text-amber-400' },
  down: { icon: XCircle, label: 'Down', cls: 'text-red-600 dark:text-red-400' },
};

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Section({ title, id, children }: { title: string; id: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 space-y-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default async function AdminPage() {
  // Unconfigured admin is indistinguishable from a missing page.
  if (!adminEnabled()) notFound();
  if (!(await isAdminSession())) return <LoginForm />;

  const s = await collectAdminSnapshot();
  const a = s.analytics;
  const worst: Status = s.health.some((c) => c.status === 'down') ? 'down' : s.health.some((c) => c.status === 'warn') ? 'warn' : 'ok';
  const W = STATUS[worst];

  return (
    <div className="space-y-10">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Platform admin</h1>
          <p className={`mt-1 flex items-center gap-1.5 text-sm ${W.cls}`}>
            <W.icon className="h-4 w-4" />
            {worst === 'ok' ? 'All systems healthy' : `${s.health.filter((c) => c.status !== 'ok').length} check(s) need attention`}
            <span className="text-muted-foreground">
              · snapshot {new Date(s.generatedAt).toLocaleTimeString()} in {(s.tookMs / 1000).toFixed(1)}s
            </span>
          </p>
        </div>
        <div className="flex gap-2">
          <nav className="mr-2 hidden items-center gap-3 text-sm text-muted-foreground lg:flex">
            {['health', 'analytics', 'users', 'agents', 'itfs', 'config'].map((id) => (
              <a key={id} href={`#${id}`} className="capitalize hover:text-foreground">
                {id === 'itfs' ? 'ITFs' : id}
              </a>
            ))}
          </nav>
          <RefreshButton />
          <SignOutButton />
        </div>
      </header>

      {s.errors.length > 0 && (
        <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-sm">
          <div className="font-medium">Some data could not be loaded; totals below may be incomplete.</div>
          <ul className="mt-1 list-disc pl-5 text-muted-foreground">
            {s.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <Section title="Health" id="health">
        <div className="grid gap-2 md:grid-cols-2">
          {s.health.map((c) => {
            const st = STATUS[c.status];
            return (
              <div key={c.name} className="flex items-start gap-3 rounded-lg border bg-card p-3">
                <st.icon className={`mt-0.5 h-4 w-4 shrink-0 ${st.cls}`} aria-label={st.label} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">{c.name}</span>
                    {c.ms !== undefined && <span className="text-xs text-muted-foreground tabular-nums">{c.ms} ms</span>}
                  </div>
                  <div className="break-words text-sm text-muted-foreground">
                    <span className={st.cls}>{st.label}</span> · {c.detail}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg border bg-card p-3 text-sm sm:grid-cols-4">
          {Object.entries(s.runtime).map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className="font-mono text-xs">{v}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title="Analytics" id="analytics">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Total AUM (community ITFs)" value={usd(a.totalAumUsd)} sub={`${a.etfCount} ITFs`} />
          <Stat label="Protocol fees accrued" value={usd(a.protocolFeesUsd)} sub={`manager fees ${usd(a.managerFeesUsd)}`} />
          <Stat label="Unique users" value={a.uniqueUsers.toLocaleString()} sub="ITF managers + agent owners" />
          <Stat label="Agents" value={a.agentCount.toLocaleString()} sub={`${a.activeAgents} active · ${a.revokedAgents} revoked`} />
          <Stat label={a.flagship ? `Flagship ${a.flagship.symbol}` : 'Flagship vault'} value={usd(a.flagship?.aumUsd)} sub={a.flagship ? `NAV ${usd(a.flagship.navPerShare)}/share` : 'not readable'} />
          <Stat label="tUSDC in agent wallets" value={usd(a.agentFundsUsd)} />
          <Stat label="tUSDC supply (faucet mints)" value={usd(a.cashSupply)} sub={`${a.listedStocks} test stocks deployed`} />
          <Stat
            label="Treasury"
            value={a.treasury ? usd(a.treasury.cash) : 'not set'}
            sub={
              a.treasury ? (
                <a href={explorerUrl(a.treasury.address)} target="_blank" rel="noreferrer" className="hover:underline">
                  {a.treasury.address.slice(0, 6)}…{a.treasury.address.slice(-4)} · {a.treasury.eth?.toFixed(4) ?? '—'} ETH
                </a>
              ) : (
                'PROTOCOL_TREASURY_ADDRESS'
              )
            }
          />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <WeeklyBars title="New ITFs per week" points={a.etfsPerWeek} />
          <WeeklyBars title="New agents per week" points={a.agentsPerWeek} />
        </div>
      </Section>

      <Section title="Users" id="users">
        <p className="text-sm text-muted-foreground">
          Wallets known to the platform: ITF managers (on-chain) and agent owners (registry). Depositors who never launched an ITF or agent are not indexed.
        </p>
        <UsersTable rows={s.users} />
      </Section>

      <Section title="Agents" id="agents">
        <AgentsTable rows={s.agents} />
      </Section>

      <Section title="ITFs" id="itfs">
        <EtfsTable rows={s.etfs} />
      </Section>

      <Section title="Config" id="config">
        <div className="grid gap-2 sm:grid-cols-2">
          {s.config.map((c) => {
            const st: Status = c.set ? 'ok' : c.required ? 'down' : 'warn';
            const S = STATUS[st];
            return (
              <div key={c.name} className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
                <S.icon className={`h-4 w-4 shrink-0 ${S.cls}`} aria-label={S.label} />
                <span className="font-mono text-xs">{c.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {c.set ? 'set' : c.required ? 'missing (required)' : 'not set'}
                  {c.note ? ` · ${c.note}` : ''}
                </span>
              </div>
            );
          })}
        </div>
        {a.signer && (
          <p className="text-xs text-muted-foreground">
            Agent signer{' '}
            <a href={explorerUrl(a.signer.address)} target="_blank" rel="noreferrer" className="font-mono hover:underline">
              {a.signer.address}
            </a>
          </p>
        )}
      </Section>
    </div>
  );
}
