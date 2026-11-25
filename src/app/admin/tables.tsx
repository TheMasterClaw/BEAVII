'use client';

import { Badge } from '@/components/ui/badge';
import { explorerUrl } from '@/config/base-sepolia';
import type { EtfSummary } from '@/lib/etf';
import type { AdminAgent, AdminUser } from '@/lib/admin/data';
import { DataTable, type Column } from './admin-client';

const usd = (n: number | null) => (n === null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: n >= 1000 ? 0 : 2 }));
const date = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const Addr = ({ a }: { a: string }) => (
  <a href={explorerUrl(a)} target="_blank" rel="noreferrer" className="font-mono text-xs hover:underline" title={a}>
    {a.slice(0, 6)}…{a.slice(-4)}
  </a>
);

const userCols: Column<AdminUser>[] = [
  { key: 'address', label: 'Wallet', render: (u) => <Addr a={u.address} /> },
  { key: 'etfs', label: 'ITFs', align: 'right', render: (u) => u.etfsManaged, sort: (u) => u.etfsManaged },
  { key: 'aum', label: 'AUM managed', align: 'right', render: (u) => usd(u.aumManagedUsd), sort: (u) => u.aumManagedUsd },
  { key: 'fees', label: 'Fees earned', align: 'right', render: (u) => usd(u.feesEarnedUsd), sort: (u) => u.feesEarnedUsd },
  { key: 'agents', label: 'Agents (active)', align: 'right', render: (u) => `${u.agents} (${u.activeAgents})`, sort: (u) => u.agents },
  { key: 'seen', label: 'First seen', render: (u) => date(u.firstSeen), sort: (u) => u.firstSeen },
];

const agentCols: Column<AdminAgent>[] = [
  { key: 'name', label: 'Agent', render: (a) => <span className="font-medium">{a.name}</span>, sort: (a) => a.name.toLowerCase() },
  { key: 'status', label: 'Status', render: (a) => <Badge variant={a.active ? 'default' : 'secondary'}>{a.active ? 'active' : 'revoked'}</Badge>, sort: (a) => (a.active ? 1 : 0) },
  { key: 'owner', label: 'Owner', render: (a) => <Addr a={a.owner} /> },
  { key: 'wallet', label: 'Agent wallet', render: (a) => <Addr a={a.address} /> },
  { key: 'cash', label: 'tUSDC', align: 'right', render: (a) => usd(a.cashBalance), sort: (a) => a.cashBalance ?? -1 },
  { key: 'eth', label: 'ETH', align: 'right', render: (a) => (a.ethBalance === null ? '—' : a.ethBalance.toFixed(4)), sort: (a) => a.ethBalance ?? -1 },
  { key: 'limit', label: 'Trade limit', align: 'right', render: (a) => (a.limits.maxTradeUsd === null ? 'none' : usd(a.limits.maxTradeUsd)) },
  { key: 'key', label: 'Key', render: (a) => <span className="font-mono text-xs text-muted-foreground">{a.keyPrefix}…</span> },
  { key: 'created', label: 'Created', render: (a) => date(a.createdAt), sort: (a) => a.createdAt },
];

const etfCols: Column<EtfSummary>[] = [
  { key: 'name', label: 'ITF', render: (e) => (
    <a href={`/dashboard/etfs/${e.address}`} className="hover:underline">
      <span className="font-medium">{e.symbol}</span> <span className="text-muted-foreground">{e.name}</span>
    </a>
  ), sort: (e) => e.symbol.toLowerCase() },
  { key: 'manager', label: 'Manager', render: (e) => <Addr a={e.manager} /> },
  { key: 'aum', label: 'AUM', align: 'right', render: (e) => usd(e.totalValueUsd), sort: (e) => e.totalValueUsd },
  { key: 'nav', label: 'NAV/share', align: 'right', render: (e) => usd(e.navPerShare), sort: (e) => e.navPerShare },
  { key: 'assets', label: 'Assets', align: 'right', render: (e) => e.assetCount, sort: (e) => e.assetCount },
  { key: 'mfee', label: 'Mgmt fee', align: 'right', render: (e) => `${(e.fees.managementFeeBps / 100).toFixed(2)}%`, sort: (e) => e.fees.managementFeeBps },
  { key: 'mgr', label: 'Manager fees', align: 'right', render: (e) => usd(e.managerFeesUsd), sort: (e) => e.managerFeesUsd },
  { key: 'proto', label: 'Protocol fees', align: 'right', render: (e) => usd(e.protocolFeesUsd), sort: (e) => e.protocolFeesUsd },
  { key: 'created', label: 'Created', render: (e) => date(e.createdAt * 1000), sort: (e) => e.createdAt },
];

export const UsersTable = ({ rows }: { rows: AdminUser[] }) => (
  <DataTable rows={rows} columns={userCols} search={(u) => u.address} rowKey={(u) => u.address} empty="No users yet." />
);
export const AgentsTable = ({ rows }: { rows: AdminAgent[] }) => (
  <DataTable rows={rows} columns={agentCols} search={(a) => `${a.name} ${a.owner} ${a.address} ${a.id}`} rowKey={(a) => a.id} empty="No agents yet." />
);
export const EtfsTable = ({ rows }: { rows: EtfSummary[] }) => (
  <DataTable rows={rows} columns={etfCols} search={(e) => `${e.symbol} ${e.name} ${e.manager} ${e.address}`} rowKey={(e) => e.address} empty="No ITFs yet." />
);
