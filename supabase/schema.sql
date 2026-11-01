-- Orbitfolio account-scoped data model.
-- Run this once in the Supabase SQL Editor for your project.

create table if not exists public.holdings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  symbol text not null check (length(trim(symbol)) > 0),
  name text not null check (length(trim(name)) > 0),
  asset_type text not null check (asset_type in ('ETF', '個股')),
  shares numeric(20, 4) not null check (shares > 0),
  average_cost numeric(20, 6) not null check (average_cost >= 0),
  purchase_date date,
  notes text not null default '',
  latest_price numeric(20, 6),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint holdings_user_symbol_unique unique (user_id, symbol),
  constraint holdings_id_user_unique unique (id, user_id)
);

create table if not exists public.exit_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  symbol text not null,
  initial_shares numeric(20, 4) not null check (initial_shares > 0),
  batches jsonb not null default '[400,400,400]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exit_plans_user_symbol_unique unique (user_id, symbol),
  constraint exit_plans_batches_array check (jsonb_typeof(batches) = 'array')
);

create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  holding_id uuid not null,
  symbol text not null,
  side text not null check (side in ('buy', 'sell', 'stock_dividend')),
  shares numeric(20, 4) not null check (shares > 0),
  execution_price numeric(20, 6) not null,
  traded_at timestamptz not null,
  fees numeric(20, 4) not null default 0 check (fees >= 0),
  notes text not null default '',
  created_at timestamptz not null default now(),
  constraint trades_owned_holding_fk foreign key (holding_id, user_id)
    references public.holdings (id, user_id) on delete restrict,
  constraint trades_execution_price_check check (
    (side = 'stock_dividend' and execution_price = 0)
    or (side in ('buy', 'sell') and execution_price > 0)
  )
);

create table if not exists public.stock_observations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  symbol text not null check (symbol = upper(trim(symbol)) and length(trim(symbol)) > 0),
  name text not null check (length(trim(name)) > 0),
  decision_status text not null default '觀察中'
    check (length(trim(decision_status)) between 1 and 40),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stock_observations_user_symbol_unique unique (user_id, symbol),
  constraint stock_observations_id_user_unique unique (id, user_id)
);

create table if not exists public.stock_observation_history (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  decision_status text not null check (length(trim(decision_status)) between 1 and 40),
  notes text not null default '',
  changed_at timestamptz not null default now(),
  constraint stock_observation_history_owner_fk foreign key (observation_id, user_id)
    references public.stock_observations (id, user_id) on delete cascade
);

create table if not exists public.stock_observation_notes (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  note text not null check (length(trim(note)) between 1 and 4000),
  created_at timestamptz not null default now(),
  constraint stock_observation_notes_owner_fk foreign key (observation_id, user_id)
    references public.stock_observations (id, user_id) on delete cascade
);

create index if not exists holdings_user_id_idx on public.holdings (user_id);
create index if not exists exit_plans_user_id_idx on public.exit_plans (user_id);
create index if not exists trades_user_id_idx on public.trades (user_id);
create index if not exists trades_holding_id_idx on public.trades (holding_id);
create index if not exists stock_observation_history_lookup_idx on public.stock_observation_history (user_id, observation_id, changed_at desc);
create index if not exists stock_observation_notes_lookup_idx on public.stock_observation_notes (user_id, observation_id, created_at desc);

alter table public.holdings enable row level security;
alter table public.exit_plans enable row level security;
alter table public.trades enable row level security;
alter table public.stock_observations enable row level security;
alter table public.stock_observation_history enable row level security;
alter table public.stock_observation_notes enable row level security;

revoke all on table public.holdings, public.exit_plans, public.trades, public.stock_observations, public.stock_observation_history, public.stock_observation_notes from anon, authenticated;
grant select, insert, update, delete on table public.holdings, public.exit_plans, public.trades to authenticated;
grant select, insert, update, delete on table public.stock_observations to authenticated;
grant select, insert on table public.stock_observation_history to authenticated;
grant select, insert, delete on table public.stock_observation_notes to authenticated;

drop policy if exists holdings_select_own on public.holdings;
create policy holdings_select_own on public.holdings for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists holdings_insert_own on public.holdings;
create policy holdings_insert_own on public.holdings for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists holdings_update_own on public.holdings;
create policy holdings_update_own on public.holdings for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists holdings_delete_own on public.holdings;
create policy holdings_delete_own on public.holdings for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists exit_plans_select_own on public.exit_plans;
create policy exit_plans_select_own on public.exit_plans for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists exit_plans_insert_own on public.exit_plans;
create policy exit_plans_insert_own on public.exit_plans for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists exit_plans_update_own on public.exit_plans;
create policy exit_plans_update_own on public.exit_plans for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists exit_plans_delete_own on public.exit_plans;
create policy exit_plans_delete_own on public.exit_plans for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists trades_select_own on public.trades;
create policy trades_select_own on public.trades for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists trades_insert_own on public.trades;
create policy trades_insert_own on public.trades for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists trades_update_own on public.trades;
create policy trades_update_own on public.trades for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists trades_delete_own on public.trades;
create policy trades_delete_own on public.trades for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists stock_observations_select_own on public.stock_observations;
create policy stock_observations_select_own on public.stock_observations for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists stock_observations_insert_own on public.stock_observations;
create policy stock_observations_insert_own on public.stock_observations for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists stock_observations_update_own on public.stock_observations;
create policy stock_observations_update_own on public.stock_observations for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists stock_observations_delete_own on public.stock_observations;
create policy stock_observations_delete_own on public.stock_observations for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists stock_observation_history_select_own on public.stock_observation_history;
create policy stock_observation_history_select_own on public.stock_observation_history for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists stock_observation_history_insert_own on public.stock_observation_history;
create policy stock_observation_history_insert_own on public.stock_observation_history for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists stock_observation_notes_select_own on public.stock_observation_notes;
create policy stock_observation_notes_select_own on public.stock_observation_notes for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists stock_observation_notes_insert_own on public.stock_observation_notes;
create policy stock_observation_notes_insert_own on public.stock_observation_notes for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists stock_observation_notes_delete_own on public.stock_observation_notes;
create policy stock_observation_notes_delete_own on public.stock_observation_notes for delete to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.record_stock_observation_history()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.stock_observation_history (observation_id, user_id, decision_status, notes, changed_at)
  values (new.id, new.user_id, new.decision_status, new.notes, new.updated_at);
  return new;
end;
$$;

drop trigger if exists stock_observation_history_on_change on public.stock_observations;
create trigger stock_observation_history_on_change
after insert or update of decision_status, notes on public.stock_observations
for each row execute function public.record_stock_observation_history();
