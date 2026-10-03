-- Mailbox v2 additive migration. Existing public.messages is intentionally preserved.
create extension if not exists pgcrypto;

alter table public.messages add column if not exists display_date date;
alter table public.messages add column if not exists message_type text not null default 'text';
alter table public.messages add column if not exists media_path text;
alter table public.messages add column if not exists media_name text;
alter table public.messages add column if not exists media_mime text;
alter table public.messages add column if not exists reply_to jsonb not null default '[]'::jsonb;

create table if not exists public.room_members (
  room_id text not null, user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null default '匿名', avatar_path text, joined_at timestamptz not null default now(),
  primary key(room_id,user_id)
);
create table if not exists public.anniversaries (
  id uuid primary key default gen_random_uuid(), room_id text not null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  title text not null, event_date date not null, created_at timestamptz not null default now()
);
create table if not exists public.memoirs (
  id uuid primary key default gen_random_uuid(), owner_user_id uuid not null references auth.users(id) on delete cascade,
  room_id text not null, title text not null default '回忆录', body text not null default '',
  range_start date, range_end date, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.listen_sessions (
  room_id text primary key, track_key text, track_name text, is_playing boolean not null default false,
  position_seconds double precision not null default 0, updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table public.room_members enable row level security;
alter table public.anniversaries enable row level security;
alter table public.memoirs enable row level security;
alter table public.listen_sessions enable row level security;

insert into storage.buckets (id,name,public,file_size_limit)
values ('message-media','message-media',false,52428800)
on conflict (id) do update set public=false,file_size_limit=52428800;

-- Legacy messages realtime only. New private tables stay fail-closed until authenticated
-- room membership policies are added in the next migration.
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null;
end $$;
