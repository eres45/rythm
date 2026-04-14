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

-- Test-only user table (no Supabase Auth). Not secure.
create table if not exists public.test_users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);

-- WARNING: This policy makes test users readable/writable by anyone with the anon key.
-- Use only for local testing.
alter table public.test_users enable row level security;
drop policy if exists "Anyone can read test users" on public.test_users;
create policy "Anyone can read test users"
  on public.test_users
  for select
  to anon
  using (true);

drop policy if exists "Anyone can write test users" on public.test_users;
create policy "Anyone can write test users"
  on public.test_users
  for insert
  to anon
  with check (true);
