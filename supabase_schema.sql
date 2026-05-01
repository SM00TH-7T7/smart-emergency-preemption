create extension if not exists "pgcrypto";

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  role text not null check (role in ('patient', 'driver', 'police'))
);

create table if not exists public.active_missions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.users(id) on delete cascade,
  driver_id uuid references public.users(id) on delete set null,
  pickup_lat double precision not null,
  pickup_lng double precision not null,
  status text not null default 'pending'
);

create table if not exists public.driver_locations (
  driver_id uuid primary key references public.users(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  updated_at timestamptz not null default now()
);

alter table public.users enable row level security;
alter table public.active_missions enable row level security;
alter table public.driver_locations enable row level security;

drop policy if exists "authenticated users can read users" on public.users;
drop policy if exists "authenticated users can insert users" on public.users;
drop policy if exists "authenticated users can update users" on public.users;
drop policy if exists "authenticated users can delete users" on public.users;

create policy "authenticated users can read users"
  on public.users for select
  to authenticated
  using (true);

create policy "authenticated users can insert users"
  on public.users for insert
  to authenticated
  with check (true);

create policy "authenticated users can update users"
  on public.users for update
  to authenticated
  using (true)
  with check (true);

create policy "authenticated users can delete users"
  on public.users for delete
  to authenticated
  using (true);

drop policy if exists "authenticated users can read active missions" on public.active_missions;
drop policy if exists "authenticated users can insert active missions" on public.active_missions;
drop policy if exists "authenticated users can update active missions" on public.active_missions;
drop policy if exists "authenticated users can delete active missions" on public.active_missions;

create policy "authenticated users can read active missions"
  on public.active_missions for select
  to authenticated
  using (true);

create policy "authenticated users can insert active missions"
  on public.active_missions for insert
  to authenticated
  with check (true);

create policy "authenticated users can update active missions"
  on public.active_missions for update
  to authenticated
  using (true)
  with check (true);

create policy "authenticated users can delete active missions"
  on public.active_missions for delete
  to authenticated
  using (true);

drop policy if exists "authenticated users can read driver locations" on public.driver_locations;
drop policy if exists "authenticated users can insert driver locations" on public.driver_locations;
drop policy if exists "authenticated users can update driver locations" on public.driver_locations;
drop policy if exists "authenticated users can delete driver locations" on public.driver_locations;

create policy "authenticated users can read driver locations"
  on public.driver_locations for select
  to authenticated
  using (true);

create policy "authenticated users can insert driver locations"
  on public.driver_locations for insert
  to authenticated
  with check (true);

create policy "authenticated users can update driver locations"
  on public.driver_locations for update
  to authenticated
  using (true)
  with check (true);

create policy "authenticated users can delete driver locations"
  on public.driver_locations for delete
  to authenticated
  using (true);
