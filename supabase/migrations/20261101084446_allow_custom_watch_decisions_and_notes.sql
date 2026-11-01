-- Allow each user to define their own decision state and append observation notes.
alter table public.stock_observations
  alter column decision_status set default '觀察中';
alter table public.stock_observations
  drop constraint if exists stock_observations_decision_status_check;
alter table public.stock_observations
  add constraint stock_observations_decision_status_check
  check (length(trim(decision_status)) between 1 and 40);

alter table public.stock_observation_history
  drop constraint if exists stock_observation_history_decision_status_check;
alter table public.stock_observation_history
  add constraint stock_observation_history_decision_status_check
  check (length(trim(decision_status)) between 1 and 40);

create table public.stock_observation_notes (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  note text not null check (length(trim(note)) between 1 and 4000),
  created_at timestamptz not null default now(),
  constraint stock_observation_notes_owner_fk foreign key (observation_id, user_id)
    references public.stock_observations (id, user_id) on delete cascade
);

create index stock_observation_notes_lookup_idx on public.stock_observation_notes (user_id, observation_id, created_at desc);
alter table public.stock_observation_notes enable row level security;
revoke all on table public.stock_observation_notes from anon, authenticated;
grant select, insert, delete on table public.stock_observation_notes to authenticated;
create policy stock_observation_notes_select_own on public.stock_observation_notes for select to authenticated
  using ((select auth.uid()) = user_id);
create policy stock_observation_notes_insert_own on public.stock_observation_notes for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy stock_observation_notes_delete_own on public.stock_observation_notes for delete to authenticated
  using ((select auth.uid()) = user_id);
