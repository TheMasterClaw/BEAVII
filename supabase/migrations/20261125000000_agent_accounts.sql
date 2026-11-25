-- BEAVII agent accounts registry (see src/lib/agent-accounts/store.ts).
-- Holds no secrets: API keys are SHA-256 hashes; agent wallets are derived from AGENT_WALLET_SEED on the server.
create table if not exists public.agent_accounts (
  id          text primary key,
  owner       text not null,
  key_hash    text,
  data        jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists agent_accounts_owner_idx on public.agent_accounts (owner);
create unique index if not exists agent_accounts_key_hash_idx on public.agent_accounts (key_hash) where key_hash is not null;

-- One-time values (owner signatures) for replay protection.
create table if not exists public.agent_once (
  value       text primary key,
  expires_at  timestamptz not null
);

-- Only the server (service role) may touch these tables: RLS on, no policies.
alter table public.agent_accounts enable row level security;
alter table public.agent_once enable row level security;
