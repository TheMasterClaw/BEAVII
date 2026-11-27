-- Daily NAV / AUM snapshots per ITF for the price-history charts (see src/lib/nav-history/store.ts).
-- Written after each oracle price sync (the only time NAV moves) and backfilled from chain history.
create table if not exists public.etf_nav_history (
  etf     text not null,               -- lowercase 0x vault address
  t       timestamptz not null,        -- snapshot time, rounded down to the hour
  nav     double precision not null,   -- NAV per share, USD
  aum     double precision not null,   -- total value, USD
  supply  double precision not null,   -- total shares
  primary key (etf, t)
);

-- Only the server (service role) may touch this table: RLS on, no policies. Reads go through /api/nav-history.
alter table public.etf_nav_history enable row level security;
