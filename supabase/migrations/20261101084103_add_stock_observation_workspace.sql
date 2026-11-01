-- Personal stock watch notes and decision history; all rows remain user-scoped.
create table public.stock_observations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  symbol text not null check (symbol = upper(trim(symbol)) and length(trim(symbol)) > 0),
  name text not null check (length(trim(name)) > 0),
  decision_status text not null default 'watching'
    check (decision_status in ('watching', 'holding', 'paused', 'closed')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stock_observations_user_symbol_unique unique (user_id, symbol),
  constraint stock_observations_id_user_unique unique (id, user_id)
);

create table public.stock_observation_history (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  decision_status text not null
    check (decision_status in ('watching', 'holding', 'paused', 'closed')),
  notes text not null default '',
  changed_at timestamptz not null default now(),
  constraint stock_observation_history_owner_fk foreign key (observation_id, user_id)
    references public.stock_observations (id, user_id) on delete cascade
);

create index stock_observations_user_idx on public.stock_observations (user_id, symbol);
create index stock_observation_history_lookup_idx on public.stock_observation_history (user_id, observation_id, changed_at desc);

alter table public.stock_observations enable row level security;
alter table public.stock_observation_history enable row level security;

revoke all on table public.stock_observations, public.stock_observation_history from anon, authenticated;
grant select, insert, update, delete on table public.stock_observations to authenticated;
grant select, insert on table public.stock_observation_history to authenticated;

create policy stock_observations_select_own on public.stock_observations for select to authenticated
  using ((select auth.uid()) = user_id);
create policy stock_observations_insert_own on public.stock_observations for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy stock_observations_update_own on public.stock_observations for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy stock_observations_delete_own on public.stock_observations for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy stock_observation_history_select_own on public.stock_observation_history for select to authenticated
  using ((select auth.uid()) = user_id);
create policy stock_observation_history_insert_own on public.stock_observation_history for insert to authenticated
  with check ((select auth.uid()) = user_id);

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

create trigger stock_observation_history_on_change
after insert or update of decision_status, notes on public.stock_observations
for each row execute function public.record_stock_observation_history();
