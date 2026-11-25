-- Wallet <-> X account links from "Verify with X" (see src/lib/x-verification/store.ts).
-- No X tokens are stored: only the X user id, handle and display name.
create table if not exists public.x_links (
  address      text primary key,          -- lowercase 0x wallet
  x_id         text not null,             -- X's stable user id
  data         jsonb not null,
  verified_at  timestamptz not null default now()
);
create unique index if not exists x_links_x_id_idx on public.x_links (x_id);

-- Only the server (service role) may touch this table: RLS on, no policies.
alter table public.x_links enable row level security;
