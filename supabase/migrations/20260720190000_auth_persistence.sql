-- Authentication persistence for the application backend.
-- The API keeps password hashes and opaque session-token hashes server-side;
-- browser clients never receive the Supabase secret key or a session token.

alter table public.app_users
  drop constraint if exists app_users_role_check;

alter table public.app_users
  add constraint app_users_role_check
  check (role in ('player', 'club', 'club_manager', 'admin'));

create table if not exists public.app_sessions (
  token_hash text primary key,
  user_id text not null references public.app_users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists app_sessions_user_id_idx
  on public.app_sessions (user_id);

create index if not exists app_sessions_expires_at_idx
  on public.app_sessions (expires_at);

alter table public.app_sessions enable row level security;
