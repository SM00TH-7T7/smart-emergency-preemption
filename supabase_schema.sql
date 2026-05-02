create extension if not exists "pgcrypto";

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  role text not null check (role in ('patient', 'driver', 'police'))
);

create table if not exists public.hospitals (
  id uuid primary key default gen_random_uuid(),
  osm_ref text unique,
  name text not null,
  lat double precision not null,
  lng double precision not null,
  address text,
  phone text,
  emergency_available boolean not null default true,
  multispeciality boolean not null default true,
  trauma_level integer not null default 1 check (trauma_level between 1 and 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.active_missions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.users(id) on delete cascade,
  driver_id uuid references public.users(id) on delete set null,
  hospital_id uuid references public.hospitals(id) on delete set null,
  pickup_lat double precision not null,
  pickup_lng double precision not null,
  status text not null default 'pending',
  route_coordinates jsonb,
  route_pickup_index integer,
  patient_picked_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.driver_locations (
  driver_id uuid primary key references public.users(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.traffic_signals (
  id uuid primary key default gen_random_uuid(),
  osm_ref text unique,
  name text not null,
  lat double precision not null,
  lng double precision not null,
  status text not null default 'red' check (status in ('red', 'green')),
  queue_length integer not null default 0 check (queue_length between 0 and 50),
  preemption_mode text not null default 'normal' check (preemption_mode in ('normal', 'ai_active', 'manual_override', 'failed')),
  active_mission_id uuid references public.active_missions(id) on delete set null,
  last_preempted_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index if not exists traffic_signals_osm_ref_unique
  on public.traffic_signals (osm_ref);

create table if not exists public.preemption_events (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.active_missions(id) on delete cascade,
  traffic_signal_id uuid not null references public.traffic_signals(id) on delete cascade,
  trigger_distance_meters integer not null,
  requested_by text not null check (requested_by in ('ai', 'police')),
  result text not null check (result in ('success', 'failed', 'manual_override')),
  created_at timestamptz not null default now()
);

alter table public.users enable row level security;
alter table public.hospitals enable row level security;
alter table public.active_missions enable row level security;
alter table public.driver_locations enable row level security;
alter table public.traffic_signals enable row level security;
alter table public.preemption_events enable row level security;

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

drop policy if exists "authenticated users can read hospitals" on public.hospitals;
drop policy if exists "authenticated users can insert hospitals" on public.hospitals;
drop policy if exists "authenticated users can update hospitals" on public.hospitals;
drop policy if exists "authenticated users can delete hospitals" on public.hospitals;

create policy "authenticated users can read hospitals"
  on public.hospitals for select
  to authenticated
  using (true);

create policy "authenticated users can insert hospitals"
  on public.hospitals for insert
  to authenticated
  with check (true);

create policy "authenticated users can update hospitals"
  on public.hospitals for update
  to authenticated
  using (true)
  with check (true);

create policy "authenticated users can delete hospitals"
  on public.hospitals for delete
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

drop policy if exists "authenticated users can read traffic signals" on public.traffic_signals;
drop policy if exists "authenticated users can insert traffic signals" on public.traffic_signals;
drop policy if exists "authenticated users can update traffic signals" on public.traffic_signals;
drop policy if exists "authenticated users can delete traffic signals" on public.traffic_signals;

create policy "authenticated users can read traffic signals"
  on public.traffic_signals for select
  to authenticated
  using (true);

create policy "authenticated users can insert traffic signals"
  on public.traffic_signals for insert
  to authenticated
  with check (true);

create policy "authenticated users can update traffic signals"
  on public.traffic_signals for update
  to authenticated
  using (true)
  with check (true);

create policy "authenticated users can delete traffic signals"
  on public.traffic_signals for delete
  to authenticated
  using (true);

drop policy if exists "authenticated users can read preemption events" on public.preemption_events;
drop policy if exists "authenticated users can insert preemption events" on public.preemption_events;
drop policy if exists "authenticated users can update preemption events" on public.preemption_events;
drop policy if exists "authenticated users can delete preemption events" on public.preemption_events;

create policy "authenticated users can read preemption events"
  on public.preemption_events for select
  to authenticated
  using (true);

create policy "authenticated users can insert preemption events"
  on public.preemption_events for insert
  to authenticated
  with check (true);

create policy "authenticated users can update preemption events"
  on public.preemption_events for update
  to authenticated
  using (true)
  with check (true);

create policy "authenticated users can delete preemption events"
  on public.preemption_events for delete
  to authenticated
  using (true);

insert into public.hospitals (osm_ref, name, lat, lng, emergency_available, multispeciality, trauma_level, address)
values
  ('node/1553576934', 'Apollo Emergency Hospital', 17.3993955, 78.4792005, true, true, 1, 'Hyderabad, Telangana'),
  ('node/2429955121', 'Yashoda Super Speciality Hospital', 17.3746556, 78.4998723, true, true, 1, 'Hyderabad, Telangana'),
  ('node/902311398', 'Oxygen Hospital', 17.4556983, 78.4984034, true, true, 2, 'Hyderabad, Telangana'),
  ('node/1435322445', 'L.K. Hospitals', 17.4513853, 78.5352525, true, true, 2, 'Hyderabad, Telangana'),
  ('node/2835658220', 'Jaiswal Multi Speciality Hospitals', 17.4510973, 78.4224934, true, true, 2, 'Hyderabad, Telangana'),
  ('node/3159027236', 'Raghava Multi Speciality Hospital', 17.4388238, 78.4420946, true, true, 2, 'Hyderabad, Telangana'),
  ('node/538425761', 'Sree Priya Multi Speciality Hospital', 17.4415414, 78.4461255, true, true, 2, 'Hyderabad, Telangana'),
  ('node/2217950153', 'OZONE HOSPITALS', 17.3594287, 78.5450683, true, true, 1, 'Hyderabad, Telangana')
on conflict (osm_ref) do update set
  name = excluded.name,
  lat = excluded.lat,
  lng = excluded.lng,
  emergency_available = excluded.emergency_available,
  multispeciality = excluded.multispeciality,
  trauma_level = excluded.trauma_level,
  address = excluded.address,
  updated_at = now();

insert into public.traffic_signals (osm_ref, name, lat, lng, status, queue_length)
values
  ('node/245640873', 'Neredmet Crossroad', 17.4818456, 78.5365375, 'green', 0),
  ('node/289907074', 'Paradise', 17.4418278, 78.4875311, 'red', 0),
  ('node/289908642', 'Tadbund Junction', 17.4568019, 78.4849664, 'red', 0),
  ('node/308796014', 'Patny', 17.4404235, 78.4953315, 'green', 0),
  ('node/308960178', 'YMCA Secunderabad Junction', 17.44325, 78.4985461, 'red', 0),
  ('node/307061321', 'Sushma Jn', 17.336643, 78.5738675, 'red', 0),
  ('node/1324659264', 'Panama Jn', 17.3378408, 78.569869, 'green', 0),
  ('node/1779503704', 'Sangeet Crossroads', 17.440854, 78.5053176, 'red', 0),
  ('node/1779544554', 'Alugaddabhavi Junction', 17.4346149, 78.5122212, 'red', 0),
  ('node/2257794896', 'Paradise Crossroads', 17.443404, 78.4872854, 'green', 0)
on conflict (osm_ref) do update set
  name = excluded.name,
  lat = excluded.lat,
  lng = excluded.lng,
  updated_at = now();

alter table public.active_missions replica identity full;
alter table public.driver_locations replica identity full;
alter table public.traffic_signals replica identity full;
alter table public.hospitals replica identity full;
alter table public.preemption_events replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.active_missions;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.driver_locations;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.traffic_signals;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.hospitals;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.preemption_events;
exception
  when duplicate_object then null;
end $$;
