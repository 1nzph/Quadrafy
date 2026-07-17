-- Initial schema for Quadrafy

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.app_users (
  id text primary key,
  role text not null check (role in ('player', 'club_manager', 'admin')),
  email text not null unique,
  password_hash text not null,
  profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.clubs (
  id text primary key,
  owner_id text not null references public.app_users(id) on delete restrict,
  name text not null,
  responsible_name text,
  cnpj text,
  status text not null default 'active' check (status in ('active', 'inactive', 'pending')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.courts (
  id text primary key,
  club_id text not null references public.clubs(id) on delete cascade,
  name text not null,
  price numeric(10,2) not null default 0,
  type text not null default 'padel',
  active boolean not null default true,
  open_time time,
  close_time time,
  slot_duration integer not null default 60,
  photo_url text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.bookings (
  id text primary key,
  player_id text not null references public.app_users(id) on delete restrict,
  club_id text not null references public.clubs(id) on delete cascade,
  court_id text not null references public.courts(id) on delete cascade,
  start_at timestamptz not null,
  price numeric(10,2) not null default 0,
  payment_method text,
  payment_status text not null default 'pending' check (payment_status in ('pending', 'paid', 'failed', 'refunded')),
  gender_category text not null default 'mixed',
  visibility text not null default 'private' check (visibility in ('private', 'open')),
  level_min integer,
  level_max integer,
  max_players integer not null default 4,
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  cancelled_at timestamptz,
  cancelled_by text references public.app_users(id) on delete set null,
  cancellation_reason text,
  refund_status text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists bookings_unique_confirmed_court_start
on public.bookings (court_id, start_at)
where status = 'confirmed';

create index if not exists bookings_player_id_idx on public.bookings (player_id);
create index if not exists bookings_club_id_idx on public.bookings (club_id);
create index if not exists bookings_court_id_idx on public.bookings (court_id);

create table if not exists public.booking_participants (
  id text primary key,
  booking_id text not null references public.bookings(id) on delete cascade,
  player_id text not null references public.app_users(id) on delete cascade,
  team integer not null check (team in (1, 2)),
  position integer not null check (position in (0, 1)),
  created_at timestamptz not null default timezone('utc', now()),
  unique (booking_id, player_id),
  unique (booking_id, team, position)
);

create table if not exists public.recurring_bookings (
  id text primary key,
  club_id text not null references public.clubs(id) on delete cascade,
  court_id text not null references public.courts(id) on delete cascade,
  client_name text not null,
  start_time time not null,
  recurrence jsonb not null default '{}'::jsonb,
  is_deleted boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.match_messages (
  id text primary key,
  match_id text not null references public.bookings(id) on delete cascade,
  player_id text not null references public.app_users(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.level_tests (
  id text primary key,
  player_id text not null references public.app_users(id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  provider text,
  raw_response jsonb,
  error text,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.level_history (
  id text primary key,
  player_id text not null references public.app_users(id) on delete cascade,
  level integer not null,
  source text not null default 'manual',
  notes text,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.match_results (
  id text primary key,
  booking_id text not null references public.bookings(id) on delete cascade,
  winner_team integer check (winner_team in (1, 2)),
  score text,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.audit_logs (
  id text primary key,
  actor_id text references public.app_users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists trg_app_users_updated_at on public.app_users;
create trigger trg_app_users_updated_at
before update on public.app_users
for each row execute function public.set_updated_at();

drop trigger if exists trg_clubs_updated_at on public.clubs;
create trigger trg_clubs_updated_at
before update on public.clubs
for each row execute function public.set_updated_at();

drop trigger if exists trg_courts_updated_at on public.courts;
create trigger trg_courts_updated_at
before update on public.courts
for each row execute function public.set_updated_at();

drop trigger if exists trg_bookings_updated_at on public.bookings;
create trigger trg_bookings_updated_at
before update on public.bookings
for each row execute function public.set_updated_at();

drop trigger if exists trg_recurring_bookings_updated_at on public.recurring_bookings;
create trigger trg_recurring_bookings_updated_at
before update on public.recurring_bookings
for each row execute function public.set_updated_at();

drop trigger if exists trg_match_results_updated_at on public.match_results;
create trigger trg_match_results_updated_at
before update on public.match_results
for each row execute function public.set_updated_at();

alter table public.app_users enable row level security;
alter table public.clubs enable row level security;
alter table public.courts enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_participants enable row level security;
alter table public.recurring_bookings enable row level security;
alter table public.match_messages enable row level security;
alter table public.level_tests enable row level security;
alter table public.level_history enable row level security;
alter table public.match_results enable row level security;
alter table public.audit_logs enable row level security;