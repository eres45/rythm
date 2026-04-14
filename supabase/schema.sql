-- Run in Supabase SQL editor
create table if not exists public.user_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_states enable row level security;

drop policy if exists "Users can read own state" on public.user_states;
create policy "Users can read own state"
  on public.user_states
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can upsert own state" on public.user_states;
create policy "Users can upsert own state"
  on public.user_states
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own state" on public.user_states;
create policy "Users can update own state"
  on public.user_states
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Optional: delete own state
-- create policy "Users can delete own state"
--   on public.user_states
--   for delete
--   to authenticated
--   using (auth.uid() = user_id);
