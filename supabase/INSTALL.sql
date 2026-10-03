-- Generated from migrations by npm run build:sql. One atomic, additive installation.
-- Run the whole file in Supabase SQL Editor. Existing messages are preserved.
begin;

-- 20260920_mailbox_v2.sql
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

-- 20260921_mailbox_auth.sql
-- Run AFTER 20260920_mailbox_v2.sql. This never adopts/locks an existing legacy room.
-- v2_ is a reserved namespace: new rooms use an independent, secret invitation token.

create schema if not exists mailbox_private;
revoke all on schema mailbox_private from public;
grant usage on schema mailbox_private to anon, authenticated;

create table if not exists public.mailbox_rooms (
  room_id text primary key check (room_id like 'v2\_%' escape '\'),
  invite_hash text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.mailbox_rooms enable row level security;
alter table public.room_members add column if not exists avatar_data text;
alter table public.messages add column if not exists author_id uuid references auth.users(id);
alter table public.messages add column if not exists client_nonce uuid;
-- Preserve the old project's actual RLS mode. Some early installations disabled
-- RLS entirely; only in that case reproduce its existing legacy-row access.
do $$ begin
  if exists(select 1 from public.messages m where left(m.room_id,3) = 'v2_'
    and not exists(select 1 from public.mailbox_rooms r where r.room_id=m.room_id)) then
    raise exception 'An existing legacy room uses the reserved v2_ prefix. Migration stopped; resolve this conflict before retrying.';
  end if;
  if not (select relrowsecurity from pg_class where oid='public.messages'::regclass) then
    drop policy if exists mailbox_legacy_compat on public.messages;
    create policy mailbox_legacy_compat on public.messages for all to anon, authenticated
      using (left(room_id,3) <> 'v2_') with check (left(room_id,3) <> 'v2_' and author_id is null);
  end if;
end $$;
alter table public.messages enable row level security;
create index if not exists messages_room_time_id_idx on public.messages(room_id, created_at, id);
create index if not exists room_members_user_idx on public.room_members(user_id, room_id);
create unique index if not exists messages_nonce_idx on public.messages(room_id, author_id, client_nonce)
  where author_id is not null and client_nonce is not null;

create or replace function mailbox_private.is_member(p_room text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.room_members m join public.mailbox_rooms r using (room_id)
    where m.room_id = p_room and m.user_id = (select auth.uid()));
$$;
revoke all on function mailbox_private.is_member(text) from public;
grant execute on function mailbox_private.is_member(text) to anon, authenticated;

-- Own profile edits only. No direct INSERT means nobody can self-enrol via REST.
revoke all on public.room_members, public.mailbox_rooms from anon, authenticated;
grant select on public.room_members to authenticated;
grant update(display_name, avatar_data) on public.room_members to authenticated;
grant select(room_id, created_by, created_at) on public.mailbox_rooms to authenticated;
drop policy if exists mailbox_members_read on public.room_members;
create policy mailbox_members_read on public.room_members for select to authenticated
  using (mailbox_private.is_member(room_id));
drop policy if exists mailbox_members_update on public.room_members;
create policy mailbox_members_update on public.room_members for update to authenticated
  using (user_id = (select auth.uid()) and mailbox_private.is_member(room_id))
  with check (user_id = (select auth.uid()) and mailbox_private.is_member(room_id));
drop policy if exists mailbox_rooms_read on public.mailbox_rooms;
create policy mailbox_rooms_read on public.mailbox_rooms for select to authenticated
  using (mailbox_private.is_member(room_id));

create or replace function mailbox_private.validate_profile()
returns trigger language plpgsql set search_path = '' as $$
begin
  if length(btrim(new.display_name)) not between 1 and 24 then
    raise exception 'Display name must be 1-24 characters' using errcode = '22023';
  end if;
  if new.avatar_data is not null and (length(new.avatar_data) > 60000 or
    new.avatar_data !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$') then
    raise exception 'Invalid avatar' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function mailbox_private.validate_profile() from public;
drop trigger if exists mailbox_profile_validate on public.room_members;
create trigger mailbox_profile_validate before insert or update on public.room_members
  for each row execute function mailbox_private.validate_profile();

create or replace function public.mailbox_create_room(p_display_name text default '我')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  rid text := 'v2_' || replace(gen_random_uuid()::text, '-', '');
  secret text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if uid is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  insert into public.mailbox_rooms(room_id, invite_hash, created_by)
    values(rid, encode(sha256(convert_to(secret, 'UTF8')), 'hex'), uid);
  insert into public.room_members(room_id, user_id, display_name)
    values(rid, uid, left(coalesce(nullif(btrim(p_display_name), ''), '我'), 24));
  return jsonb_build_object('room_id', rid, 'invite', secret);
end;
$$;
revoke all on function public.mailbox_create_room(text) from public, anon;
grant execute on function public.mailbox_create_room(text) to authenticated;

create or replace function public.mailbox_join_room(p_room_id text, p_invite text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if mailbox_private.is_member(p_room_id) then return; end if;
  if length(p_invite) <> 64 or not exists (
    select 1 from public.mailbox_rooms where room_id = p_room_id
    and invite_hash = encode(sha256(convert_to(p_invite, 'UTF8')), 'hex')
  ) then raise exception 'Invalid invitation' using errcode = '42501'; end if;
  insert into public.room_members(room_id, user_id, display_name) values(p_room_id, uid, '朋友')
    on conflict(room_id, user_id) do nothing;
end;
$$;
revoke all on function public.mailbox_join_room(text, text) from public, anon;
grant execute on function public.mailbox_join_room(text, text) to authenticated;

-- IMPORTANT: legacy policies may be permissive (OR). RESTRICTIVE guards (AND)
-- protect EVERY v2_ row even if an old policy says USING(true).
grant select, insert on public.messages to authenticated;
grant update(display_date) on public.messages to authenticated;
drop policy if exists mailbox_messages_read_guard on public.messages;
create policy mailbox_messages_read_guard on public.messages as restrictive for select to anon, authenticated
  using (left(room_id, 3) <> 'v2_' or mailbox_private.is_member(room_id));
drop policy if exists mailbox_messages_insert_guard on public.messages;
create policy mailbox_messages_insert_guard on public.messages as restrictive for insert to anon, authenticated
  with check ((left(room_id, 3) <> 'v2_' and author_id is null) or
    (mailbox_private.is_member(room_id) and author_id = (select auth.uid()) and sender = (select auth.uid())::text));
drop policy if exists mailbox_messages_update_guard on public.messages;
create policy mailbox_messages_update_guard on public.messages as restrictive for update to anon, authenticated
  using (left(room_id, 3) <> 'v2_' or (mailbox_private.is_member(room_id) and author_id = (select auth.uid())))
  with check ((left(room_id, 3) <> 'v2_' and author_id is null) or
    (mailbox_private.is_member(room_id) and author_id = (select auth.uid())));
drop policy if exists mailbox_messages_delete_guard on public.messages;
create policy mailbox_messages_delete_guard on public.messages as restrictive for delete to anon, authenticated
  using (left(room_id, 3) <> 'v2_');
drop policy if exists mailbox_messages_member_read on public.messages;
create policy mailbox_messages_member_read on public.messages for select to authenticated
  using (mailbox_private.is_member(room_id));
drop policy if exists mailbox_messages_member_insert on public.messages;
create policy mailbox_messages_member_insert on public.messages for insert to authenticated
  with check (mailbox_private.is_member(room_id) and author_id = (select auth.uid()));
drop policy if exists mailbox_messages_owner_date on public.messages;
create policy mailbox_messages_owner_date on public.messages for update to authenticated
  using (mailbox_private.is_member(room_id) and author_id = (select auth.uid()))
  with check (mailbox_private.is_member(room_id) and author_id = (select auth.uid()));

create or replace function mailbox_private.validate_message()
returns trigger language plpgsql security definer set search_path = '' as $$
declare ref jsonb;
begin
  if tg_op = 'UPDATE' then
    if left(old.room_id, 3) = 'v2_' or left(new.room_id, 3) = 'v2_' then
      -- Existing public UPDATE grants must not allow moving a row out of protection
      -- or forging sender/created_at/content through a permissive legacy policy.
      if (to_jsonb(new) - 'display_date') is distinct from (to_jsonb(old) - 'display_date') then
        raise exception 'Only display_date can be edited' using errcode = '42501';
      end if;
    end if;
  end if;
  if left(new.room_id, 3) = 'v2_' then
    if new.author_id is distinct from auth.uid() or not mailbox_private.is_member(new.room_id)
      or new.sender is distinct from auth.uid()::text then
      raise exception 'Invalid message author' using errcode = '42501';
    end if;
    if new.client_nonce is null or length(btrim(new.content)) not between 1 and 5000
      or new.message_type <> 'text' then
      raise exception 'Invalid message' using errcode = '22023';
    end if;
    if tg_op = 'INSERT' then new.created_at := now(); end if;
    if jsonb_typeof(new.reply_to) <> 'array' then
      raise exception 'Invalid references' using errcode = '22023';
    end if;
    if jsonb_array_length(new.reply_to) > 8 then
      raise exception 'Too many references' using errcode = '22023';
    end if;
    for ref in select value from jsonb_array_elements(new.reply_to) loop
      if jsonb_typeof(ref) <> 'string' or not exists (
        select 1 from public.messages m where m.room_id = new.room_id and m.id::text = (ref #>> '{}')
      ) then raise exception 'Reference must belong to this room' using errcode = '22023'; end if;
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function mailbox_private.validate_message() from public;
drop trigger if exists mailbox_message_validate on public.messages;
create trigger mailbox_message_validate before insert or update on public.messages
  for each row execute function mailbox_private.validate_message();

-- Future features stay CLOSED until their workflows are implemented and tested.
revoke all on public.anniversaries, public.memoirs, public.listen_sessions from anon, authenticated;
drop policy if exists mailbox_media_closed on storage.objects;
create policy mailbox_media_closed on storage.objects as restrictive for all to anon, authenticated
  using (bucket_id <> 'message-media') with check (bucket_id <> 'message-media');

do $$ begin
  alter publication supabase_realtime add table public.room_members;
exception when duplicate_object then null;
end $$;
notify pgrst, 'reload schema';

-- 20260922_mailbox_features.sql
-- Run after 20260920 and 20260921. Additive: original messages are never deleted.

alter table public.mailbox_rooms add column if not exists relationship_since date;
alter table public.messages add column if not exists media_size bigint;
alter table public.messages add column if not exists import_label text;
alter table public.anniversaries add column if not exists repeat_yearly boolean not null default true;
alter table public.memoirs add column if not exists revision integer not null default 1;
alter table public.listen_sessions add column if not exists revision bigint not null default 1;
create index if not exists messages_media_path_idx on public.messages(media_path) where media_path is not null;
create index if not exists anniversaries_room_idx on public.anniversaries(room_id);
create index if not exists memoirs_owner_room_idx on public.memoirs(owner_user_id,room_id);

grant select(relationship_since) on public.mailbox_rooms to authenticated;
grant update(relationship_since) on public.mailbox_rooms to authenticated;
drop policy if exists mailbox_relationship_update on public.mailbox_rooms;
create policy mailbox_relationship_update on public.mailbox_rooms for update to authenticated
 using (mailbox_private.is_member(room_id)) with check (mailbox_private.is_member(room_id));

-- Shared calendar: everyone in the room may read; only the author may edit/delete.
-- Memoirs: even another member of the same room cannot read an owner's drafts.
revoke all on public.anniversaries, public.memoirs, public.listen_sessions from anon, authenticated;
grant select,insert,update,delete on public.anniversaries, public.memoirs to authenticated;
grant select on public.listen_sessions to authenticated;
do $$ declare tab text; read_guard text; write_guard text; begin
 for tab in select unnest(array['anniversaries','memoirs']) loop
  read_guard := 'mailbox_private.is_member(room_id)' || case when tab='memoirs' then ' and owner_user_id=(select auth.uid())' else '' end;
  write_guard := 'mailbox_private.is_member(room_id) and owner_user_id=(select auth.uid())';
  execute format('drop policy if exists mailbox_feature_read on public.%I',tab);
  execute format('create policy mailbox_feature_read on public.%I for select to authenticated using (%s)',tab,read_guard);
  execute format('drop policy if exists mailbox_feature_read_guard on public.%I',tab);
  execute format('create policy mailbox_feature_read_guard on public.%I as restrictive for select to anon,authenticated using (%s)',tab,read_guard);
  execute format('drop policy if exists mailbox_feature_write on public.%I',tab);
  execute format('create policy mailbox_feature_write on public.%I for all to authenticated using (%s) with check (%s)',tab,write_guard,write_guard);
  execute format('drop policy if exists mailbox_feature_insert_guard on public.%I',tab);
  execute format('create policy mailbox_feature_insert_guard on public.%I as restrictive for insert to anon,authenticated with check (%s)',tab,write_guard);
  execute format('drop policy if exists mailbox_feature_update_guard on public.%I',tab);
  execute format('create policy mailbox_feature_update_guard on public.%I as restrictive for update to anon,authenticated using (%s) with check (%s)',tab,write_guard,write_guard);
  execute format('drop policy if exists mailbox_feature_delete_guard on public.%I',tab);
  execute format('create policy mailbox_feature_delete_guard on public.%I as restrictive for delete to anon,authenticated using (%s)',tab,write_guard);
 end loop;
end $$;

create or replace function mailbox_private.validate_feature()
returns trigger language plpgsql set search_path='' as $$ begin
 if tg_op='UPDATE' and (new.id<>old.id or new.room_id<>old.room_id or new.owner_user_id<>old.owner_user_id or new.created_at<>old.created_at) then
  raise exception 'Identity and origin cannot change' using errcode='42501';
 end if;
 if length(btrim(new.title)) not between 1 and 120 then raise exception 'Invalid title' using errcode='22023'; end if;
 if tg_table_name='memoirs' then
  if length(new.body)>200000 or new.range_start is null or new.range_end is null or new.range_start>new.range_end then
   raise exception 'Invalid memoir range or length' using errcode='22023';
  end if;
  if tg_op='INSERT' then new.revision:=1;
  elsif new.revision<>old.revision+1 then raise exception 'Stale memoir revision' using errcode='40001'; end if;
  new.updated_at:=now();
 end if;
 if tg_op='INSERT' then new.created_at:=now(); end if;
 return new;
end $$;
revoke all on function mailbox_private.validate_feature() from public;
drop trigger if exists mailbox_calendar_validate on public.anniversaries;
create trigger mailbox_calendar_validate before insert or update on public.anniversaries for each row execute function mailbox_private.validate_feature();
drop trigger if exists mailbox_memoir_validate on public.memoirs;
create trigger mailbox_memoir_validate before insert or update on public.memoirs for each row execute function mailbox_private.validate_feature();

-- Storage paths are room/user/nonce. Published attachments are immutable.
create or replace function mailbox_private.media_owner(p_path text)
returns boolean language sql stable security definer set search_path='' as $$
 select p_path ~ '^v2_[A-Za-z0-9_-]+/[a-f0-9-]{36}/[a-f0-9-]{36}$'
 and split_part(p_path,'/',2)=(select auth.uid())::text
 and mailbox_private.is_member(split_part(p_path,'/',1));
$$;
create or replace function mailbox_private.media_read(p_path text)
returns boolean language sql stable security definer set search_path='' as $$
 select mailbox_private.is_member(split_part(p_path,'/',1)) and (
  mailbox_private.media_owner(p_path) or exists(select 1 from public.messages where media_path=p_path and room_id=split_part(p_path,'/',1)));
$$;
create or replace function mailbox_private.media_discard(p_path text)
returns boolean language sql stable security definer set search_path='' as $$
 select mailbox_private.media_owner(p_path) and not exists(select 1 from public.messages where media_path=p_path);
$$;
revoke all on function mailbox_private.media_owner(text),mailbox_private.media_read(text),mailbox_private.media_discard(text) from public;
grant execute on function mailbox_private.media_owner(text),mailbox_private.media_read(text),mailbox_private.media_discard(text) to anon,authenticated;
update storage.buckets set public=false,file_size_limit=20971520,
 allowed_mime_types=array['image/jpeg','image/png','image/webp','image/gif','audio/mpeg','audio/mp4','audio/ogg','audio/wav','audio/x-wav','audio/webm','audio/flac','video/mp4','video/webm','application/pdf','text/plain','application/zip','application/x-zip-compressed','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation']
 where id='message-media';
drop policy if exists mailbox_media_closed on storage.objects;
drop policy if exists mailbox_media_read_guard on storage.objects;
create policy mailbox_media_read_guard on storage.objects as restrictive for select to anon,authenticated using(bucket_id<>'message-media' or mailbox_private.media_read(name));
drop policy if exists mailbox_media_insert_guard on storage.objects;
create policy mailbox_media_insert_guard on storage.objects as restrictive for insert to anon,authenticated with check(bucket_id<>'message-media' or mailbox_private.media_owner(name));
drop policy if exists mailbox_media_update_guard on storage.objects;
create policy mailbox_media_update_guard on storage.objects as restrictive for update to anon,authenticated using(bucket_id<>'message-media') with check(bucket_id<>'message-media');
drop policy if exists mailbox_media_delete_guard on storage.objects;
create policy mailbox_media_delete_guard on storage.objects as restrictive for delete to anon,authenticated using(bucket_id<>'message-media' or mailbox_private.media_discard(name));
drop policy if exists mailbox_media_read on storage.objects;
create policy mailbox_media_read on storage.objects for select to authenticated using(bucket_id='message-media' and mailbox_private.media_read(name));
drop policy if exists mailbox_media_insert on storage.objects;
create policy mailbox_media_insert on storage.objects for insert to authenticated with check(bucket_id='message-media' and mailbox_private.media_owner(name));
drop policy if exists mailbox_media_delete on storage.objects;
create policy mailbox_media_delete on storage.objects for delete to authenticated using(bucket_id='message-media' and mailbox_private.media_discard(name));

create or replace function mailbox_private.validate_message()
returns trigger language plpgsql security definer set search_path='' as $$ declare ref jsonb; begin
 if tg_op='UPDATE' and (left(old.room_id,3)='v2_' or left(new.room_id,3)='v2_') then
  if (to_jsonb(new)-'display_date') is distinct from (to_jsonb(old)-'display_date') then
   raise exception 'Only display_date can be edited' using errcode='42501';
  end if;
 end if;
 if left(new.room_id,3)='v2_' then
  if new.author_id is distinct from auth.uid() or not mailbox_private.is_member(new.room_id) or new.sender is distinct from auth.uid()::text then
   raise exception 'Invalid message author' using errcode='42501';
  end if;
  if new.client_nonce is null or length(new.content)>5000 or new.message_type not in ('text','image','audio','video','file','import') then
   raise exception 'Invalid message' using errcode='22023';
  end if;
  if new.message_type in ('text','import') then
   if length(btrim(new.content))<1 or new.media_path is not null or new.media_size is not null or new.media_mime is not null or new.media_name is not null then
    raise exception 'Invalid text message' using errcode='22023';
   end if;
  else
   if new.media_path is null or not mailbox_private.media_owner(new.media_path) or split_part(new.media_path,'/',1)<>new.room_id
    or split_part(new.media_path,'/',3)<>new.client_nonce::text
    or new.media_size is null or new.media_size not between 1 and 20971520
    or new.media_name is null or length(new.media_name) not between 1 and 180 or new.media_mime is null
    or new.media_mime not in ('image/jpeg','image/png','image/webp','image/gif','audio/mpeg','audio/mp4','audio/ogg','audio/wav','audio/x-wav','audio/webm','audio/flac','video/mp4','video/webm','application/pdf','text/plain','application/zip','application/x-zip-compressed','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation')
    or new.message_type <> (case when new.media_mime like 'image/%' then 'image' when new.media_mime like 'audio/%' then 'audio' when new.media_mime like 'video/%' then 'video' else 'file' end)
    or not exists(select 1 from storage.objects where bucket_id='message-media' and name=new.media_path
     and (metadata->>'size')::bigint=new.media_size and metadata->>'mimetype'=new.media_mime) then
    raise exception 'Invalid or missing attachment' using errcode='22023';
   end if;
  end if;
  if new.message_type='import' then
   if new.import_label is null or length(btrim(new.import_label)) not between 1 and 24 then raise exception 'Missing import source' using errcode='22023'; end if;
  elsif new.import_label is not null and (new.media_path is null or length(btrim(new.import_label)) not between 1 and 24) then raise exception 'Invalid import source' using errcode='22023'; end if;
  if tg_op='INSERT' then new.created_at:=now(); end if;
  if jsonb_typeof(new.reply_to)<>'array' or jsonb_array_length(new.reply_to)>8 then raise exception 'Invalid references' using errcode='22023'; end if;
  for ref in select value from jsonb_array_elements(new.reply_to) loop
   if jsonb_typeof(ref)<>'string' or not exists(select 1 from public.messages m where m.room_id=new.room_id and m.id::text=(ref#>>'{}')) then
    raise exception 'Reference must belong to this room' using errcode='22023';
   end if;
  end loop;
 end if;
 return new;
end $$;

-- Listening uses compare-and-swap revisions, server timestamps, authenticated authors.
drop policy if exists mailbox_listen_read on public.listen_sessions;
create policy mailbox_listen_read on public.listen_sessions for select to authenticated using(mailbox_private.is_member(room_id));
drop policy if exists mailbox_listen_read_guard on public.listen_sessions;
create policy mailbox_listen_read_guard on public.listen_sessions as restrictive for select to anon,authenticated using(mailbox_private.is_member(room_id));
create or replace function public.mailbox_read_listen(p_room text)
returns jsonb language plpgsql security definer set search_path='' as $$ declare row public.listen_sessions; begin
 if not mailbox_private.is_member(p_room) then raise exception 'Membership required' using errcode='42501'; end if;
 select * into row from public.listen_sessions where room_id=p_room;
 return jsonb_build_object('session',case when row.room_id is null then null else to_jsonb(row) end,'server_now',clock_timestamp());
end $$;
create or replace function public.mailbox_set_listen(p_room text,p_key text,p_name text,p_playing boolean,p_position double precision,p_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$ declare row public.listen_sessions; begin
 if not mailbox_private.is_member(p_room) then raise exception 'Membership required' using errcode='42501'; end if;
 if p_key is null or p_key!~'^[a-f0-9]{64}$' or p_name is null or length(p_name) not between 1 and 180 or p_playing is null
  or p_position is null or p_position<0 or p_position>86400 or p_position='NaN'::float8 or p_revision is null or p_revision<0 then
  raise exception 'Invalid listening state' using errcode='22023';
 end if;
 if p_revision=0 then
  insert into public.listen_sessions(room_id,track_key,track_name,is_playing,position_seconds,updated_by,updated_at,revision)
   values(p_room,p_key,p_name,p_playing,p_position,auth.uid(),clock_timestamp(),1) on conflict(room_id) do nothing returning * into row;
 else
  update public.listen_sessions set track_key=p_key,track_name=p_name,is_playing=p_playing,position_seconds=p_position,
   updated_by=auth.uid(),updated_at=clock_timestamp(),revision=revision+1
   where room_id=p_room and revision=p_revision returning * into row;
 end if;
 if row.room_id is null then raise exception 'Listening state changed; refresh before retry' using errcode='40001'; end if;
 return jsonb_build_object('session',to_jsonb(row),'server_now',clock_timestamp());
end $$;
revoke all on function public.mailbox_read_listen(text),public.mailbox_set_listen(text,text,text,boolean,double precision,bigint) from public,anon;
grant execute on function public.mailbox_read_listen(text),public.mailbox_set_listen(text,text,text,boolean,double precision,bigint) to authenticated;
do $$ begin
 alter publication supabase_realtime add table public.listen_sessions;
exception when duplicate_object then null;
end $$;
do $$ begin
 alter publication supabase_realtime add table public.anniversaries;
exception when duplicate_object then null;
end $$;
notify pgrst,'reload schema';

-- 20260923_mailbox_push.sql
-- Additive. No message contents, invite secrets or VAPID private keys in these tables.

create table if not exists public.push_subscriptions(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 room_id text not null references public.mailbox_rooms(room_id) on delete cascade,
 endpoint text not null check(length(endpoint) between 20 and 2048 and endpoint like 'https://%'),
 p256dh text not null check(p256dh ~ '^[A-Za-z0-9_-]{87}=?$'),
 auth text not null check(auth ~ '^[A-Za-z0-9_-]{22}=?=?$'),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(user_id,room_id,endpoint)
);
create index if not exists push_subscriptions_room_idx on public.push_subscriptions(room_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon,authenticated;
grant select,insert,update,delete on public.push_subscriptions to authenticated;
drop policy if exists mailbox_push_own on public.push_subscriptions;
create policy mailbox_push_own on public.push_subscriptions for all to authenticated
 using(user_id=(select auth.uid()) and mailbox_private.is_member(room_id))
 with check(user_id=(select auth.uid()) and mailbox_private.is_member(room_id));
drop policy if exists mailbox_push_guard on public.push_subscriptions;
create policy mailbox_push_guard on public.push_subscriptions as restrictive for all to anon,authenticated
 using(user_id=(select auth.uid()) and mailbox_private.is_member(room_id))
 with check(user_id=(select auth.uid()) and mailbox_private.is_member(room_id));
create or replace function mailbox_private.validate_push_subscription()
returns trigger language plpgsql security definer set search_path='' as $$ begin
 if tg_op='UPDATE' and (new.id<>old.id or new.user_id<>old.user_id or new.room_id<>old.room_id or new.endpoint<>old.endpoint or new.created_at<>old.created_at) then
  raise exception 'Subscription identity cannot change' using errcode='42501';
 end if;
 -- Bound storage/fanout, while permitting retries of the same subscription.
 perform pg_advisory_xact_lock(hashtext(new.user_id::text));
 if tg_op='INSERT' and not exists(select 1 from public.push_subscriptions where user_id=new.user_id and room_id=new.room_id and endpoint=new.endpoint)
  and (select count(*) from public.push_subscriptions where user_id=new.user_id and room_id=new.room_id)>=5 then
  raise exception 'At most five devices per room' using errcode='22023';
 end if;
 new.updated_at:=now();return new;
end $$;
revoke all on function mailbox_private.validate_push_subscription() from public;
drop trigger if exists mailbox_push_validate on public.push_subscriptions;
create trigger mailbox_push_validate before insert or update on public.push_subscriptions for each row execute function mailbox_private.validate_push_subscription();

-- Service-only deduplication. Text IDs support legacy bigint and UUID message schemas.
create table if not exists public.mailbox_push_deliveries(
 subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
 message_id text not null,
 status text not null default 'sending' check(status in ('sending','sent','failed')),
 lease_until timestamptz not null default(now()+interval '1 minute'),
 attempts integer not null default 1,
 created_at timestamptz not null default now(),
 primary key(subscription_id,message_id)
);
alter table public.mailbox_push_deliveries enable row level security;
revoke all on public.mailbox_push_deliveries from anon,authenticated;
grant all on public.push_subscriptions,public.mailbox_push_deliveries to service_role;
create or replace function public.mailbox_claim_push(p_subscription uuid,p_message text)
returns boolean language plpgsql security definer set search_path='' as $$ declare claimed boolean; begin
 insert into public.mailbox_push_deliveries(subscription_id,message_id) values(p_subscription,p_message)
 on conflict(subscription_id,message_id) do update set status='sending',lease_until=now()+interval '1 minute',attempts=public.mailbox_push_deliveries.attempts+1
 where public.mailbox_push_deliveries.status<>'sent' and public.mailbox_push_deliveries.lease_until<now() and public.mailbox_push_deliveries.attempts<5
 returning true into claimed;
 return coalesce(claimed,false);
end $$;
revoke all on function public.mailbox_claim_push(uuid,text) from public,anon,authenticated;
grant execute on function public.mailbox_claim_push(uuid,text) to service_role;
notify pgrst,'reload schema';

-- 20261001_identity.sql
-- Stable Auth UUID for every NEW message, including legacy rooms. No old row is
-- reassigned, deleted, or inferred from a nickname/device/browser identifier.

drop policy if exists mailbox_messages_insert_guard on public.messages;
create policy mailbox_messages_insert_guard on public.messages as restrictive for insert to anon,authenticated
 with check (auth.uid() is not null and author_id=auth.uid() and sender=auth.uid()::text
 and (left(room_id,3)<>'v2_' or mailbox_private.is_member(room_id)));
-- Only adjust the compatibility grant that this project created for previously
-- public legacy rooms. Other installations keep their own legacy read policy.
do $$ begin
 if exists(select 1 from pg_policies where schemaname='public' and tablename='messages' and policyname='mailbox_legacy_compat') then
  drop policy mailbox_legacy_compat on public.messages;
  create policy mailbox_legacy_compat on public.messages for all to anon,authenticated
   using(left(room_id,3)<>'v2_') with check(left(room_id,3)<>'v2_' and author_id=auth.uid());
 end if;
end $$;
create or replace function mailbox_private.validate_author_identity()
returns trigger language plpgsql set search_path='' as $$ begin
 if tg_op='INSERT' then
  if auth.uid() is null or new.author_id is distinct from auth.uid() or new.sender is distinct from auth.uid()::text or new.client_nonce is null then
   raise exception 'An authenticated author and nonce are required' using errcode='42501';
  end if;
  new.created_at:=now();
 elsif auth.uid() is not null and (new.author_id is distinct from old.author_id or new.sender is distinct from old.sender or new.room_id is distinct from old.room_id or new.created_at is distinct from old.created_at) then
  raise exception 'Message identity and origin are immutable' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function mailbox_private.validate_author_identity() from public;
drop trigger if exists mailbox_author_identity on public.messages;
create trigger mailbox_author_identity before insert or update on public.messages for each row execute function mailbox_private.validate_author_identity();
notify pgrst,'reload schema';

-- 20261002_message_cards.sql

alter table public.messages add column if not exists message_payload jsonb;
alter table public.messages add column if not exists card_revision integer not null default 1;
update storage.buckets set file_size_limit=83886080,allowed_mime_types=array(select distinct unnest(allowed_mime_types||array['application/octet-stream','video/quicktime','audio/aac'])) where id='message-media';

create or replace function mailbox_private.card_has_path(p jsonb, path text)
returns boolean language sql immutable set search_path='' as $$
 select exists(select 1 from jsonb_array_elements(coalesce(p->'entries','[]'::jsonb)) e where e->>'media_path'=path)
 or exists(select 1 from jsonb_array_elements(coalesce(p->'originals','[]'::jsonb)) e where e->>'path'=path);
$$;
create or replace function mailbox_private.validate_card(p jsonb, room text)
returns boolean language plpgsql security definer set search_path='' as $$
declare e jsonb; path text; begin
 if p is null or jsonb_typeof(p)<>'object' or p->>'version' is distinct from '1' or p->>'kind' not in ('screenshot','forward') or octet_length(p::text)>1500000 then return false; end if;
 if jsonb_typeof(p->'entries') is distinct from 'array' or jsonb_typeof(p->'originals') is distinct from 'array' then return false; end if;
 if jsonb_array_length(p->'entries') not between 1 and 100 or jsonb_array_length(p->'originals')>100 then return false; end if;
 for e in select value from jsonb_array_elements(p->'entries') loop
  if jsonb_typeof(e)<>'object' or length(coalesce(e->>'text',''))>5000 or length(coalesce(e->>'label',''))>120 or coalesce(e->>'side','unknown') not in ('left','right','unknown') then return false; end if;
  if nullif(e->>'date','') is not null then perform (e->>'date')::date; end if;
  if nullif(e->>'time','') is not null and e->>'time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' then return false; end if;
 end loop;
 for e in select value from jsonb_array_elements(p->'entries') where value->>'media_path' is not null
 union all select jsonb_build_object('media_path',value->>'path','media_size',value->>'size','media_mime',value->>'mime') from jsonb_array_elements(p->'originals') loop
  path:=e->>'media_path';
  if path is null or split_part(path,'/',1)<>room or not mailbox_private.media_owner(path)
   or not exists(select 1 from storage.objects where bucket_id='message-media' and name=path and (metadata->>'size')::bigint=(e->>'media_size')::bigint and metadata->>'mimetype'=e->>'media_mime') then return false; end if;
 end loop;
 return true;
 exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then return false;
end $$;
revoke all on function mailbox_private.validate_card(jsonb,text),mailbox_private.card_has_path(jsonb,text) from public;

create or replace function mailbox_private.media_read(p_path text)
returns boolean language sql stable security definer set search_path='' as $$
 select mailbox_private.is_member(split_part(p_path,'/',1)) and (mailbox_private.media_owner(p_path) or exists(select 1 from public.messages where room_id=split_part(p_path,'/',1) and (media_path=p_path or mailbox_private.card_has_path(message_payload,p_path))));
$$;
create or replace function mailbox_private.media_discard(p_path text)
returns boolean language sql stable security definer set search_path='' as $$
 select mailbox_private.media_owner(p_path) and not exists(select 1 from public.messages where media_path=p_path or mailbox_private.card_has_path(message_payload,p_path));
$$;

create or replace function mailbox_private.validate_message()
returns trigger language plpgsql security definer set search_path='' as $$ declare ref jsonb; begin
 if tg_op='UPDATE' and (left(old.room_id,3)='v2_' or left(new.room_id,3)='v2_') then
  if old.message_type in ('screenshot','forward') and new.message_type=old.message_type and new.author_id=auth.uid() then
   if (to_jsonb(new)-array['display_date','message_payload','content','card_revision']) is distinct from (to_jsonb(old)-array['display_date','message_payload','content','card_revision']) then raise exception 'Card origin is immutable' using errcode='42501'; end if;
   if new.message_payload is distinct from old.message_payload and new.card_revision<>old.card_revision+1 then raise exception 'Stale card revision' using errcode='40001'; end if;
  elsif (to_jsonb(new)-'display_date') is distinct from (to_jsonb(old)-'display_date') then
   raise exception 'Only display_date can be edited' using errcode='42501';
  end if;
 end if;
 if left(new.room_id,3)='v2_' then
  if new.author_id is distinct from auth.uid() or not mailbox_private.is_member(new.room_id) or new.sender is distinct from auth.uid()::text then
   raise exception 'Invalid message author' using errcode='42501';
  end if;
  if new.client_nonce is null or length(new.content)>5000 or new.message_type not in ('text','image','audio','video','file','import','screenshot','forward') then
   raise exception 'Invalid message' using errcode='22023';
  end if;
  if new.message_type in ('screenshot','forward') then
   if new.media_path is not null or new.message_payload->>'kind' is distinct from new.message_type or not mailbox_private.validate_card(new.message_payload,new.room_id) then raise exception 'Invalid message card' using errcode='22023'; end if;
  elsif new.message_type in ('text','import') then
   if length(btrim(new.content))<1 or new.media_path is not null or new.media_size is not null or new.media_mime is not null or new.media_name is not null then
    raise exception 'Invalid text message' using errcode='22023';
   end if;
  else
   if new.media_path is null or not mailbox_private.media_owner(new.media_path) or split_part(new.media_path,'/',1)<>new.room_id
    or split_part(new.media_path,'/',3)<>new.client_nonce::text
    or new.media_size is null or new.media_size not between 1 and 20971520
    or new.media_name is null or length(new.media_name) not between 1 and 180 or new.media_mime is null
    or new.media_mime not in ('application/octet-stream','video/quicktime','audio/aac','image/jpeg','image/png','image/webp','image/gif','audio/mpeg','audio/mp4','audio/ogg','audio/wav','audio/x-wav','audio/webm','audio/flac','video/mp4','video/webm','application/pdf','text/plain','application/zip','application/x-zip-compressed','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation')
    or new.message_type <> (case when new.media_mime like 'image/%' then 'image' when new.media_mime like 'audio/%' then 'audio' when new.media_mime like 'video/%' then 'video' else 'file' end)
    or not exists(select 1 from storage.objects where bucket_id='message-media' and name=new.media_path
     and (metadata->>'size')::bigint=new.media_size and metadata->>'mimetype'=new.media_mime) then
    raise exception 'Invalid or missing attachment' using errcode='22023';
   end if;
  end if;
  if new.message_type='import' then
   if new.import_label is null or length(btrim(new.import_label)) not between 1 and 24 then raise exception 'Missing import source' using errcode='22023'; end if;
  elsif new.import_label is not null and (new.media_path is null or length(btrim(new.import_label)) not between 1 and 24) then raise exception 'Invalid import source' using errcode='22023'; end if;
  if tg_op='INSERT' then new.created_at:=now(); end if;
  if jsonb_typeof(new.reply_to)<>'array' or jsonb_array_length(new.reply_to)>8 then raise exception 'Invalid references' using errcode='22023'; end if;
  for ref in select value from jsonb_array_elements(new.reply_to) loop
   if jsonb_typeof(ref)<>'string' or not exists(select 1 from public.messages m where m.room_id=new.room_id and m.id::text=(ref#>>'{}')) then
    raise exception 'Reference must belong to this room' using errcode='22023';
   end if;
  end loop;
 end if;
 return new;
end $$;

create or replace function public.mailbox_edit_card(p_room text,p_id text,p_revision integer,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.messages; begin
 if not mailbox_private.is_member(p_room) then raise exception 'Membership required' using errcode='42501'; end if;
 select * into m from public.messages where room_id=p_room and id::text=p_id for update;
 if m.id is null or m.author_id is distinct from auth.uid() or m.message_type<>'screenshot' then raise exception 'Own screenshot required' using errcode='42501'; end if;
 if m.card_revision<>p_revision then raise exception 'Stale card revision' using errcode='40001'; end if;
 if p_payload->>'kind'<>'screenshot' or not mailbox_private.validate_card(p_payload,p_room) then raise exception 'Invalid card' using errcode='22023'; end if;
 update public.messages set message_payload=p_payload,card_revision=card_revision+1,content=left(coalesce((p_payload->'entries'->0->>'text'),'截图摘录'),500)
 where id=m.id returning * into m;
 return to_jsonb(m);
end $$;
revoke all on function public.mailbox_edit_card(text,text,integer,jsonb) from public,anon;
grant execute on function public.mailbox_edit_card(text,text,integer,jsonb) to authenticated;
notify pgrst,'reload schema';

-- 20261003_daily_space.sql
-- Daily records and pocket bookkeeping. No money is held or transferred here.

alter table public.anniversaries add column if not exists note text not null default '';
alter table public.anniversaries add column if not exists remind boolean not null default true;
create table if not exists public.space_entries(
 id uuid primary key, room_id text not null references public.mailbox_rooms(room_id),
 owner_user_id uuid not null references auth.users(id),
 kind text not null check(kind in ('diary','goal','checkin','ledger','todo','activity','memory')),
 visibility text not null default 'shared' check(visibility in ('private','shared')),
 title text not null default '', body text not null default '', event_date date not null default current_date,
 data jsonb not null default '{}', revision integer not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists space_entries_room_date on public.space_entries(room_id,event_date desc,id);
create unique index if not exists space_checkin_once on public.space_entries(room_id,owner_user_id,(data->>'goal'),event_date) where kind='checkin';
alter table public.space_entries enable row level security;
revoke all on public.space_entries from anon,authenticated;
grant select,insert,update,delete on public.space_entries to authenticated;
drop policy if exists space_read on public.space_entries;
create policy space_read on public.space_entries for select to authenticated using(mailbox_private.is_member(room_id) and (visibility='shared' or owner_user_id=auth.uid()));
drop policy if exists space_write on public.space_entries;
create policy space_write on public.space_entries for all to authenticated using(mailbox_private.is_member(room_id) and owner_user_id=auth.uid()) with check(mailbox_private.is_member(room_id) and owner_user_id=auth.uid());
create or replace function mailbox_private.validate_space()
returns trigger language plpgsql set search_path='' as $$
declare m jsonb; g public.space_entries; begin
 if tg_op='UPDATE' then
  if (new.id,new.room_id,new.owner_user_id,new.kind,new.created_at) is distinct from (old.id,old.room_id,old.owner_user_id,old.kind,old.created_at) then raise exception 'Origin cannot change' using errcode='42501'; end if;
  if new.revision<>old.revision+1 then raise exception 'Stale record' using errcode='40001'; end if;
 else new.created_at:=now(); new.revision:=1; end if;
 new.updated_at:=now();
 if length(new.title)>120 or length(new.body)>20000 or jsonb_typeof(new.data)<>'object' or octet_length(new.data::text)>100000 then raise exception 'Record too long' using errcode='22023'; end if;
 if jsonb_typeof(coalesce(new.data->'media','[]'))<>'array' or jsonb_array_length(coalesce(new.data->'media','[]'))>8 then raise exception 'Invalid media' using errcode='22023'; end if;
 for m in select value from jsonb_array_elements(coalesce(new.data->'media','[]')) loop
  if not mailbox_private.media_owner(m->>'path') or split_part(m->>'path','/',1)<>new.room_id or not exists(select 1 from storage.objects where bucket_id='message-media' and name=m->>'path' and (metadata->>'size')::bigint=(m->>'size')::bigint and metadata->>'mimetype'=m->>'mime') then raise exception 'Invalid attachment' using errcode='22023'; end if;
 end loop;
 if new.kind='ledger' and (coalesce(new.data->>'cents','') !~ '^[1-9][0-9]{0,9}$' or not exists(select 1 from public.room_members where room_id=new.room_id and user_id::text=new.data->>'paid_by')) then raise exception 'Invalid ledger record' using errcode='22023'; end if;
 if new.kind in ('goal','todo','activity') and length(btrim(new.title))=0 then raise exception 'Title required' using errcode='22023'; end if;
 if new.kind='checkin' then
  select * into g from public.space_entries where id::text=new.data->>'goal' and room_id=new.room_id and kind='goal';
  if g.id is null or (g.visibility='private' and g.owner_user_id<>auth.uid()) or new.event_date>(clock_timestamp() at time zone 'Asia/Shanghai')::date then raise exception 'Invalid goal or date' using errcode='22023'; end if;
  if new.visibility<>g.visibility then raise exception 'Goal visibility differs' using errcode='22023'; end if;
 end if;
 return new;
end $$;
revoke all on function mailbox_private.validate_space() from public;
drop trigger if exists space_validate on public.space_entries;
create trigger space_validate before insert or update on public.space_entries for each row execute function mailbox_private.validate_space();

create table if not exists public.pockets(
 id uuid primary key,room_id text not null references public.mailbox_rooms(room_id), owner_user_id uuid not null references auth.users(id),
 title text not null, target_cents bigint not null check(target_cents>0), daily_cents bigint not null default 0 check(daily_cents>=0),
 mode text not null check(mode in ('daily','free')),due_date date,note text not null default '',
 qr_path text not null,cover_path text,created_at timestamptz not null default now()
);
create table if not exists public.pocket_entries(
 id uuid primary key,pocket_id uuid not null references public.pockets(id),room_id text not null references public.mailbox_rooms(room_id),
 owner_user_id uuid not null references auth.users(id),kind text not null check(kind in ('deposit','withdraw')),
 cents bigint not null check(cents>0),reason text not null default '',status text not null check(status in ('settled','pending','cancelled')),
 available_at timestamptz,created_at timestamptz not null default now(),settled_at timestamptz
);
create table if not exists public.pocket_leaves(
 id uuid primary key,pocket_id uuid not null references public.pockets(id),room_id text not null references public.mailbox_rooms(room_id),
 owner_user_id uuid not null references auth.users(id),date_start date not null,date_end date not null,reason text not null,
 created_at timestamptz not null default now(),check(date_start<=date_end),check(length(btrim(reason)) between 1 and 1000)
);
create index if not exists pocket_entries_pocket on public.pocket_entries(pocket_id,created_at);
do $$ declare t text; begin foreach t in array array['pockets','pocket_entries','pocket_leaves'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('drop policy if exists pocket_read on public.%I',t);
 execute format('create policy pocket_read on public.%I for select to authenticated using(mailbox_private.is_member(room_id))',t);
 end loop; end $$;
create or replace function public.mailbox_create_pocket(p_id uuid,p_room text,p_title text,p_target bigint,p_daily bigint,p_mode text,p_due date,p_note text,p_qr text,p_cover text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.pockets; path text; begin
 if not mailbox_private.is_member(p_room) then raise exception 'Membership required' using errcode='42501'; end if;
 select * into r from public.pockets where id=p_id;
 if r.id is not null then
  if r.room_id=p_room and r.owner_user_id=auth.uid() and (r.title,r.target_cents,r.daily_cents,r.mode,r.due_date,r.note,r.qr_path,r.cover_path) is not distinct from (p_title,p_target,p_daily,p_mode,p_due,p_note,p_qr,p_cover) then return to_jsonb(r); end if;
  raise exception 'Request ID already used' using errcode='22023';
 end if;
 if p_id is null or p_title is null or length(btrim(p_title)) not between 1 and 120 or p_target is null or p_target not between 1 and 9999999999 or p_daily is null or p_daily<0 or p_daily>9999999999 or p_mode is null or p_mode not in ('daily','free') or (p_mode='daily' and p_daily=0) or p_qr is null or p_note is null or length(p_note)>1000 then raise exception 'Invalid pocket' using errcode='22023'; end if;
 foreach path in array array[p_qr,p_cover] loop
  if path is null then continue; end if;
  if split_part(path,'/',1)<>p_room or not mailbox_private.media_owner(path) or not exists(select 1 from storage.objects where bucket_id='message-media' and name=path and metadata->>'mimetype' like 'image/%') then raise exception 'Invalid image' using errcode='22023'; end if;
 end loop;
 insert into public.pockets(id,room_id,owner_user_id,title,target_cents,daily_cents,mode,due_date,note,qr_path,cover_path) values(p_id,p_room,auth.uid(),p_title,p_target,p_daily,p_mode,p_due,p_note,p_qr,p_cover) returning * into r;
 return to_jsonb(r);
end $$;
create or replace function public.mailbox_pocket_action(p_pocket uuid,p_id uuid,p_action text,p_cents bigint default null,p_reason text default '',p_hours integer default 24,p_emergency boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.pockets; r public.pocket_entries; balance bigint; begin
 select * into p from public.pockets where id=p_pocket for update;
 if p.id is null or not mailbox_private.is_member(p.room_id) then raise exception 'Membership required' using errcode='42501'; end if;
 if p_id is null or p_action is null or p_action not in ('deposit','withdraw','confirm','cancel') then raise exception 'Invalid action' using errcode='22023'; end if;
 select * into r from public.pocket_entries where id=p_id;
 if r.id is not null and (r.owner_user_id<>auth.uid() or r.pocket_id<>p_pocket) then raise exception 'Own entry required' using errcode='42501'; end if;
 select coalesce(sum(case when kind='deposit' then cents else -cents end),0) into balance from public.pocket_entries where pocket_id=p_pocket and status='settled';
 if p_action in ('confirm','cancel') then
  if r.id is null or r.kind<>'withdraw' then raise exception 'Withdrawal required' using errcode='22023'; end if;
  if (p_action='confirm' and r.status='settled') or (p_action='cancel' and r.status='cancelled') then return to_jsonb(r); end if;
  if r.status<>'pending' then raise exception 'Request already closed' using errcode='22023'; end if;
  if p_action='confirm' and (r.available_at>clock_timestamp() or r.cents>balance) then raise exception 'Cooling period or balance' using errcode='22023'; end if;
  update public.pocket_entries set status=case when p_action='confirm' then 'settled' else 'cancelled' end,settled_at=case when p_action='confirm' then clock_timestamp() else null end where id=p_id returning * into r;
 else
  if r.id is not null then
   if r.kind=p_action and r.cents=p_cents and r.reason=p_reason then return to_jsonb(r); end if;
   raise exception 'Request ID already used' using errcode='22023';
  end if;
  if p_cents is null or p_cents not between 1 and 9999999999 or p_reason is null or length(p_reason)>1000 or (p_action='withdraw' and length(btrim(p_reason))=0) or p_hours is null or p_hours not in (24,48) or p_emergency is null then raise exception 'Invalid amount or reason' using errcode='22023'; end if;
  if p_action='withdraw' and p_cents>balance then raise exception 'Insufficient balance' using errcode='22023'; end if;
  insert into public.pocket_entries(id,pocket_id,room_id,owner_user_id,kind,cents,reason,status,available_at,settled_at)
   values(p_id,p.id,p.room_id,auth.uid(),p_action,p_cents,p_reason,
    case when p_action='deposit' or p_emergency then 'settled' else 'pending' end,
    case when p_action='withdraw' and not p_emergency then clock_timestamp()+make_interval(hours=>p_hours) else null end,
    case when p_action='deposit' or p_emergency then clock_timestamp() else null end) returning * into r;
 end if;
 return to_jsonb(r);
end $$;
create or replace function public.mailbox_pocket_leave(p_pocket uuid,p_id uuid,p_start date,p_end date,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.pockets; r public.pocket_leaves; begin
 select * into p from public.pockets where id=p_pocket;
 if p.id is null or not mailbox_private.is_member(p.room_id) then raise exception 'Membership required' using errcode='42501'; end if;
 if p_start is null or p_end is null or p_start>p_end or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'Invalid leave' using errcode='22023'; end if;
 select * into r from public.pocket_leaves where id=p_id;
 if r.id is not null then
  if (r.pocket_id,r.owner_user_id,r.date_start,r.date_end,r.reason) is not distinct from (p_pocket,auth.uid(),p_start,p_end,p_reason) then return to_jsonb(r); end if;
  raise exception 'Request ID already used' using errcode='22023';
 end if;
 insert into public.pocket_leaves(id,pocket_id,room_id,owner_user_id,date_start,date_end,reason) values(p_id,p.id,p.room_id,auth.uid(),p_start,p_end,p_reason) returning * into r;return to_jsonb(r);
end $$;
revoke all on function public.mailbox_create_pocket(uuid,text,text,bigint,bigint,text,date,text,text,text),public.mailbox_pocket_action(uuid,uuid,text,bigint,text,integer,boolean),public.mailbox_pocket_leave(uuid,uuid,date,date,text) from public,anon;
grant execute on function public.mailbox_create_pocket(uuid,text,text,bigint,bigint,text,date,text,text,text),public.mailbox_pocket_action(uuid,uuid,text,bigint,text,integer,boolean),public.mailbox_pocket_leave(uuid,uuid,date,date,text) to authenticated;

create or replace function public.mailbox_space_clock(p_room text)
returns jsonb language plpgsql security definer set search_path='' as $$ begin
 if not mailbox_private.is_member(p_room) then raise exception 'Membership required' using errcode='42501'; end if;
 return jsonb_build_object('server_now',clock_timestamp());
end $$;
revoke all on function public.mailbox_space_clock(text) from public,anon;
grant execute on function public.mailbox_space_clock(text) to authenticated;

-- Private diary images remain private even to another room member.
create or replace function mailbox_private.media_read(p_path text)
returns boolean language sql stable security definer set search_path='' as $$
 select mailbox_private.is_member(split_part(p_path,'/',1)) and (
 mailbox_private.media_owner(p_path) or exists(select 1 from public.messages where room_id=split_part(p_path,'/',1) and (media_path=p_path or mailbox_private.card_has_path(message_payload,p_path)))
 or exists(select 1 from public.space_entries s where s.room_id=split_part(p_path,'/',1) and (s.visibility='shared' or s.owner_user_id=auth.uid()) and exists(select 1 from jsonb_array_elements(coalesce(s.data->'media','[]')) m where m->>'path'=p_path))
 or exists(select 1 from public.pockets p where p.room_id=split_part(p_path,'/',1) and p_path in (p.qr_path,p.cover_path)));
$$;
create or replace function mailbox_private.media_discard(p_path text)
returns boolean language sql stable security definer set search_path='' as $$
 select mailbox_private.media_owner(p_path)
 and not exists(select 1 from public.messages where media_path=p_path or mailbox_private.card_has_path(message_payload,p_path))
 and not exists(select 1 from public.space_entries s where exists(select 1 from jsonb_array_elements(coalesce(s.data->'media','[]')) m where m->>'path'=p_path))
 and not exists(select 1 from public.pockets where p_path in (qr_path,cover_path));
$$;
do $$ declare t text; begin foreach t in array array['space_entries','pockets','pocket_entries','pocket_leaves'] loop
 begin execute format('alter publication supabase_realtime add table public.%I',t);exception when duplicate_object then null;end;
 end loop;end $$;
notify pgrst,'reload schema';

-- 20261004_music_space.sql
-- Music metadata, independent likes and measured simultaneous playback. No audio upload.

create table if not exists public.music_tracks(
 room_id text not null references public.mailbox_rooms(room_id),owner_user_id uuid not null references auth.users(id),
 track_key text not null check(track_key ~ '^[a-f0-9]{64}$'),title text not null,artist text not null default '',
 genre text not null default '',category text not null default '',visibility text not null default 'private' check(visibility in ('private','shared')),
 lyrics jsonb not null default '[]',duration double precision not null default 0,
 primary key(room_id,owner_user_id,track_key),check(length(title) between 1 and 180),check(length(artist)<=120),
 check(length(genre)<=60 and length(category)<=60),check(jsonb_typeof(lyrics)='array' and octet_length(lyrics::text)<=200000),check(duration>=0 and duration<=86400)
);
create table if not exists public.music_likes(
 room_id text not null references public.mailbox_rooms(room_id),owner_user_id uuid not null references auth.users(id),
 track_key text not null check(track_key ~ '^[a-f0-9]{64}$'),created_at timestamptz not null default now(),primary key(room_id,owner_user_id,track_key)
);
create table if not exists public.music_colors(
 room_id text not null references public.mailbox_rooms(room_id),owner_user_id uuid not null references auth.users(id),
 color text not null check(color ~ '^#[a-fA-F0-9]{6}$'),primary key(room_id,owner_user_id)
);
create table if not exists public.music_playlists(
 id uuid primary key,room_id text not null references public.mailbox_rooms(room_id),owner_user_id uuid not null references auth.users(id),
 title text not null check(length(btrim(title)) between 1 and 120),visibility text not null check(visibility in ('private','shared')),
 track_keys text[] not null default '{}',revision integer not null default 1,check(cardinality(track_keys)<=1000)
);
do $$ declare t text; readable text; writable text; begin
 foreach t in array array['music_tracks','music_likes','music_colors','music_playlists'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to authenticated',t);
  readable:='mailbox_private.is_member(room_id)'||case when t in ('music_tracks','music_playlists') then ' and (visibility=''shared'' or owner_user_id=auth.uid())' else '' end;
  writable:='mailbox_private.is_member(room_id) and ('||case when t='music_playlists' then 'visibility=''shared'' or ' else '' end||'owner_user_id=auth.uid())';
  execute format('drop policy if exists music_read on public.%I',t);
  execute format('create policy music_read on public.%I for select to authenticated using (%s)',t,readable);
  execute format('drop policy if exists music_insert on public.%I',t);
  execute format('create policy music_insert on public.%I for insert to authenticated with check(mailbox_private.is_member(room_id) and owner_user_id=auth.uid())',t);
  execute format('drop policy if exists music_update on public.%I',t);
  execute format('create policy music_update on public.%I for update to authenticated using (%s) with check (%s)',t,writable,writable);
  execute format('drop policy if exists music_delete on public.%I',t);
  execute format('create policy music_delete on public.%I for delete to authenticated using(mailbox_private.is_member(room_id) and owner_user_id=auth.uid())',t);
 end loop;
end $$;
create or replace function mailbox_private.validate_music()
returns trigger language plpgsql set search_path='' as $$ declare k text; begin
 if tg_op='UPDATE' and (new.room_id,new.owner_user_id) is distinct from (old.room_id,old.owner_user_id) then raise exception 'Origin cannot change' using errcode='42501'; end if;
 if tg_table_name='music_tracks' then
  if tg_op='UPDATE' and new.track_key<>old.track_key then raise exception 'Track cannot change' using errcode='42501'; end if;
  if tg_op='UPDATE' and old.visibility='shared' and new.visibility='private' then raise exception 'Shared metadata cannot become private' using errcode='22023'; end if;
 elsif tg_table_name='music_playlists' then
  if tg_op='UPDATE' and (new.id<>old.id or new.visibility<>old.visibility) then raise exception 'Playlist origin cannot change' using errcode='42501'; end if;
  if tg_op='INSERT' then new.revision:=1; elsif new.revision<>old.revision+1 then raise exception 'Playlist changed' using errcode='40001'; end if;
  foreach k in array new.track_keys loop
   if k !~ '^[a-f0-9]{64}$' or not exists(select 1 from public.music_tracks t where t.room_id=new.room_id and t.track_key=k and (t.visibility='shared' or (new.visibility='private' and t.owner_user_id=auth.uid()))) then raise exception 'Track not available to playlist' using errcode='22023'; end if;
  end loop;
 elsif tg_table_name='music_likes' then
  if tg_op='UPDATE' and new.track_key<>old.track_key then raise exception 'Like origin cannot change' using errcode='42501'; end if;
  if not exists(select 1 from public.music_tracks where room_id=new.room_id and track_key=new.track_key and visibility='shared') then raise exception 'Shared track required' using errcode='22023'; end if;
 end if;
 return new;
end $$;
revoke all on function mailbox_private.validate_music() from public;
do $$ declare t text; begin foreach t in array array['music_tracks','music_likes','music_colors','music_playlists'] loop
 execute format('drop trigger if exists music_validate on public.%I',t);
 execute format('create trigger music_validate before insert or update on public.%I for each row execute function mailbox_private.validate_music()',t);
 begin execute format('alter publication supabase_realtime add table public.%I',t); exception when duplicate_object then null; end;
end loop; end $$;

alter table public.listen_sessions add column if not exists play_id uuid not null default gen_random_uuid();
create or replace function public.mailbox_set_listen(p_room text,p_key text,p_name text,p_playing boolean,p_position double precision,p_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$ declare row public.listen_sessions; begin
 if not mailbox_private.is_member(p_room) then raise exception 'Membership required' using errcode='42501'; end if;
 if p_key is null or p_key!~'^[a-f0-9]{64}$' or p_name is null or length(p_name) not between 1 and 180 or p_playing is null
  or p_position is null or p_position<0 or p_position>86400 or p_position='NaN'::float8 or p_revision is null or p_revision<0 then raise exception 'Invalid listening state' using errcode='22023'; end if;
 if p_revision=0 then
  insert into public.listen_sessions(room_id,track_key,track_name,is_playing,position_seconds,updated_by,updated_at,revision)
  values(p_room,p_key,p_name,p_playing,p_position,auth.uid(),clock_timestamp(),1) on conflict(room_id) do nothing returning * into row;
 else
  update public.listen_sessions set play_id=case when track_key<>p_key or (p_playing and p_position<3 and position_seconds+case when is_playing then extract(epoch from clock_timestamp()-updated_at) else 0 end>10) then gen_random_uuid() else play_id end,
   track_key=p_key,track_name=p_name,is_playing=p_playing,position_seconds=p_position,updated_by=auth.uid(),updated_at=clock_timestamp(),revision=revision+1
   where room_id=p_room and revision=p_revision returning * into row;
 end if;
 if row.room_id is null then raise exception 'Listening state changed; refresh before retry' using errcode='40001'; end if;
 return jsonb_build_object('session',to_jsonb(row),'server_now',clock_timestamp());
end $$;
create table if not exists public.listen_presence(
 room_id text not null references public.mailbox_rooms(room_id),user_id uuid not null references auth.users(id),
 track_key text not null,position_seconds double precision not null,playing boolean not null,
 seen_at timestamptz not null,span_id uuid,primary key(room_id,user_id)
);
create table if not exists public.listen_spans(
 id uuid primary key default gen_random_uuid(),room_id text not null references public.mailbox_rooms(room_id),user_id uuid not null references auth.users(id),
 track_key text not null,play_id uuid not null default gen_random_uuid(),started_at timestamptz not null,ended_at timestamptz not null,check(ended_at>=started_at)
);
create index if not exists listen_spans_room_time on public.listen_spans(room_id,track_key,started_at,ended_at);
alter table public.listen_presence enable row level security;
alter table public.listen_spans enable row level security;
revoke all on public.listen_presence,public.listen_spans from public,anon,authenticated;
-- A UUID contributes at most one live interval, even with several devices open.
create or replace function public.mailbox_listen_heartbeat(p_room text,p_key text,p_position double precision,p_playing boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prev public.listen_presence;s public.listen_sessions;t timestamptz:=clock_timestamp();gap double precision;delta double precision;sid uuid;valid boolean; begin
 if not mailbox_private.is_member(p_room) then raise exception 'Membership required' using errcode='42501'; end if;
 if p_key is null or p_key!~'^[a-f0-9]{64}$' or p_position is null or p_position<0 or p_position>86400 or p_position='NaN'::float8 or p_playing is null then raise exception 'Invalid heartbeat' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_room||auth.uid()::text,0));
 select * into s from public.listen_sessions where room_id=p_room;
 select * into prev from public.listen_presence where room_id=p_room and user_id=auth.uid() for update;
 gap:=extract(epoch from t-prev.seen_at);delta:=p_position-prev.position_seconds;
 valid:=p_playing and s.is_playing and s.track_key=p_key and abs(p_position-(s.position_seconds+extract(epoch from t-s.updated_at)))<3;
 if valid and prev.playing and prev.track_key=p_key and gap between 1 and 12 and delta between gap*0.65 and gap*1.35 then
  select id into sid from public.listen_spans where id=prev.span_id and play_id=s.play_id;
  if sid is null then insert into public.listen_spans(room_id,user_id,track_key,play_id,started_at,ended_at) values(p_room,auth.uid(),p_key,s.play_id,prev.seen_at,t) returning id into sid;
  else update public.listen_spans set ended_at=t where id=sid; end if;
 end if;
 insert into public.listen_presence(room_id,user_id,track_key,position_seconds,playing,seen_at,span_id)
 values(p_room,auth.uid(),p_key,p_position,coalesce(valid,false),t,sid)
 on conflict(room_id,user_id) do update set track_key=excluded.track_key,position_seconds=excluded.position_seconds,playing=excluded.playing,seen_at=excluded.seen_at,span_id=excluded.span_id;
 return jsonb_build_object('server_now',t,'listeners',(select count(distinct user_id) from public.listen_presence where room_id=p_room and track_key=p_key and playing and seen_at>t-interval '12 seconds'));
end $$;
-- Intersect different UUIDs, union overlapping pairs, then split at Shanghai midnight.
-- Only acknowledged playback intervals count; offline time, buffering and solo time do not.
create or replace function public.mailbox_listen_report(p_room text,p_start date,p_end date)
returns jsonb language plpgsql security definer set search_path='' as $$ declare result jsonb; begin
 if not mailbox_private.is_member(p_room) then raise exception 'Membership required' using errcode='42501'; end if;
 if p_start is null or p_end is null or p_start>p_end or p_end-p_start>370 then raise exception 'Invalid range' using errcode='22023'; end if;
 with intersections as (
  select a.track_key,a.play_id,tstzrange(greatest(a.started_at,b.started_at),least(a.ended_at,b.ended_at),'[)') r
  from public.listen_spans a join public.listen_spans b on a.room_id=b.room_id and a.track_key=b.track_key and a.play_id=b.play_id and a.user_id<b.user_id
   and a.started_at<b.ended_at and b.started_at<a.ended_at where a.room_id=p_room
 ), unions as(select track_key,play_id,range_agg(r) ranges from intersections group by track_key,play_id),
 pieces as(select track_key,play_id,unnest(ranges) r from unions),
 bounded as(select track_key,play_id,r*tstzrange(p_start::timestamp at time zone 'Asia/Shanghai',(p_end+1)::timestamp at time zone 'Asia/Shanghai','[)') r from pieces),
 periods as(select * from bounded where not isempty(r)),
 days as(select track_key,d::date as "day",extract(epoch from least(upper(r),(d::date+1)::timestamp at time zone 'Asia/Shanghai')-greatest(lower(r),d::date::timestamp at time zone 'Asia/Shanghai')) seconds
  from periods cross join lateral generate_series((lower(r) at time zone 'Asia/Shanghai')::date::timestamp,((upper(r)-interval '1 microsecond') at time zone 'Asia/Shanghai')::date::timestamp,interval '1 day') d),
 daily as(select "day",sum(seconds) seconds from days group by "day" order by "day"),
 tracks as(select track_key,sum(extract(epoch from upper(r)-lower(r))) seconds,count(distinct play_id) plays,max(upper(r)) last_played from periods group by track_key)
 select jsonb_build_object('daily',coalesce((select jsonb_agg(to_jsonb(daily)) from daily),'[]'::jsonb),'tracks',coalesce((select jsonb_agg(to_jsonb(tracks)) from tracks),'[]'::jsonb),
 'total_seconds',coalesce((select sum(extract(epoch from upper(r)-lower(r))) from pieces),0)) into result;
 return result;
end $$;
revoke all on function public.mailbox_listen_heartbeat(text,text,double precision,boolean),public.mailbox_listen_report(text,date,date) from public,anon;
grant execute on function public.mailbox_listen_heartbeat(text,text,double precision,boolean),public.mailbox_listen_report(text,date,date) to authenticated;
notify pgrst,'reload schema';

-- 20261005_memories.sql
-- Views share source messages/diaries. Layout, annotations and personal films contain references.

create table if not exists public.memory_profiles(
 room_id text not null references public.mailbox_rooms(room_id),owner_user_id uuid not null references auth.users(id),
 data jsonb not null default '{}',revision integer not null default 1,primary key(room_id,owner_user_id),
 check(jsonb_typeof(data)='object' and octet_length(data::text)<=500000)
);
create table if not exists public.memory_films(
 id uuid primary key,room_id text not null references public.mailbox_rooms(room_id),owner_user_id uuid not null references auth.users(id),
 title text not null check(length(btrim(title)) between 1 and 120),frames jsonb not null default '[]',
 bgm jsonb,revision integer not null default 1,updated_at timestamptz not null default now(),
 check(jsonb_typeof(frames)='array' and jsonb_array_length(frames)<=300 and octet_length(frames::text)<=100000)
);
do $$ declare t text; begin foreach t in array array['memory_profiles','memory_films'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant select,insert,update,delete on public.%I to authenticated',t);
 execute format('drop policy if exists memory_own on public.%I',t);
 execute format('create policy memory_own on public.%I for all to authenticated using(mailbox_private.is_member(room_id) and owner_user_id=auth.uid()) with check(mailbox_private.is_member(room_id) and owner_user_id=auth.uid())',t);
 end loop;end $$;
create or replace function mailbox_private.validate_memory()
returns trigger language plpgsql set search_path='' as $$ declare f jsonb; begin
 if tg_op='UPDATE' then
  if (new.room_id,new.owner_user_id) is distinct from (old.room_id,old.owner_user_id) then raise exception 'Origin cannot change' using errcode='42501'; end if;
  if new.revision<>old.revision+1 then raise exception 'Memory changed' using errcode='40001'; end if;
 else new.revision:=1;end if;
 if tg_table_name='memory_films' then
  if tg_op='UPDATE' and new.id<>old.id then raise exception 'Film ID cannot change' using errcode='42501'; end if;
  for f in select value from jsonb_array_elements(new.frames) loop
   if coalesce(f->>'source','')!~'^(message|entry|event|music|summary):[A-Za-z0-9_-]{1,100}$' or jsonb_typeof(f->'seconds') is distinct from 'number' or (f->>'seconds')::numeric not between 1 and 60 then raise exception 'Invalid frame' using errcode='22023';end if;
  end loop;
  if new.bgm is not null and (not mailbox_private.media_owner(new.bgm->>'path') or split_part(new.bgm->>'path','/',1)<>new.room_id or not exists(select 1 from storage.objects where bucket_id='message-media' and name=new.bgm->>'path' and metadata->>'mimetype' like 'audio/%')) then raise exception 'Invalid soundtrack' using errcode='22023';end if;
  new.updated_at:=now();
 end if;
 return new;
end $$;
revoke all on function mailbox_private.validate_memory() from public;
do $$ declare t text;begin foreach t in array array['memory_profiles','memory_films'] loop
 execute format('drop trigger if exists memory_validate on public.%I',t);
 execute format('create trigger memory_validate before insert or update on public.%I for each row execute function mailbox_private.validate_memory()',t);
end loop;end $$;
-- A soundtrack already used by a private film must not disappear through orphan cleanup.
create or replace function mailbox_private.media_discard(p_path text)
returns boolean language sql stable security definer set search_path='' as $$
 select mailbox_private.media_owner(p_path)
 and not exists(select 1 from public.messages where media_path=p_path or mailbox_private.card_has_path(message_payload,p_path))
 and not exists(select 1 from public.space_entries s where exists(select 1 from jsonb_array_elements(coalesce(s.data->'media','[]')) m where m->>'path'=p_path))
 and not exists(select 1 from public.pockets where p_path in (qr_path,cover_path))
 and not exists(select 1 from public.memory_films where bgm->>'path'=p_path);
$$;
notify pgrst,'reload schema';

-- 20261006_pet.sql
-- Explicit per-author chat consent. Pet results remain private to their owner.

create table if not exists public.pet_consents(
 room_id text not null references public.mailbox_rooms(room_id),user_id uuid not null references auth.users(id),
 enabled boolean not null default false,automatic boolean not null default false,
 date_start date not null,date_end date,revision integer not null default 1,
 primary key(room_id,user_id),check(date_end is null or date_start<=date_end)
);
create table if not exists public.pet_states(
 room_id text not null references public.mailbox_rooms(room_id),owner_user_id uuid not null references auth.users(id),
 data jsonb not null,source_count integer not null,source_hash text not null,
 generations integer not null default 1,updated_at timestamptz not null default now(),
 primary key(room_id,owner_user_id),check(octet_length(data::text)<=16000)
);
create table if not exists mailbox_private.pet_jobs(
 room_id text not null,user_id uuid not null,request_id uuid,source_hash text,
 last_attempt timestamptz,attempt_day date,attempts integer not null default 0,
 primary key(room_id,user_id)
);
alter table public.pet_consents enable row level security;
alter table public.pet_states enable row level security;
revoke all on public.pet_consents,public.pet_states from anon,authenticated;
grant select on public.pet_consents,public.pet_states to authenticated;
drop policy if exists pet_consent_read on public.pet_consents;
create policy pet_consent_read on public.pet_consents for select to authenticated using(mailbox_private.is_member(room_id));
drop policy if exists pet_state_read on public.pet_states;
create policy pet_state_read on public.pet_states for select to authenticated using(mailbox_private.is_member(room_id) and owner_user_id=auth.uid());

create or replace function public.mailbox_pet_consent(p_room text,p_enabled boolean,p_auto boolean,p_start date,p_end date default null)
returns jsonb language plpgsql security definer set search_path='' as $$ declare r public.pet_consents; begin
 if not mailbox_private.is_member(p_room) then raise exception 'Membership required' using errcode='42501';end if;
 if p_enabled is null or p_auto is null or p_start is null or p_start>'2100-01-01'::date or p_start<'1900-01-01'::date or p_start>p_end then raise exception 'Invalid scope' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtext('pet:'||p_room));
 insert into public.pet_consents(room_id,user_id,enabled,automatic,date_start,date_end)
 values(p_room,auth.uid(),p_enabled,p_auto and p_enabled,p_start,p_end)
 on conflict(room_id,user_id) do update set enabled=excluded.enabled,automatic=excluded.automatic,date_start=excluded.date_start,date_end=excluded.date_end,revision=public.pet_consents.revision+1 returning * into r;
 -- Discard every derivative of the previous scope, including in-flight model requests.
 delete from public.pet_states where room_id=p_room;
 update mailbox_private.pet_jobs set request_id=null,source_hash=null where room_id=p_room;
 return to_jsonb(r);
end $$;
revoke all on function public.mailbox_pet_consent(text,boolean,boolean,date,date) from public,anon;
grant execute on function public.mailbox_pet_consent(text,boolean,boolean,date,date) to authenticated;

create or replace function mailbox_private.pet_context(p_room text,p_user uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('messages',coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at,m.id) from (
  select x.id::text,x.author_id::text as author,left(x.content,1500) as text,x.created_at
  from public.messages x join public.pet_consents c on c.room_id=x.room_id and c.user_id=x.author_id and c.enabled
  join public.room_members rm on rm.room_id=c.room_id and rm.user_id=c.user_id
  where x.room_id=p_room and x.message_type='text' and nullif(x.import_label,'') is null
  and (x.created_at at time zone 'Asia/Shanghai')::date>=c.date_start
  and (c.date_end is null or (x.created_at at time zone 'Asia/Shanghai')::date<=c.date_end)
  and length(btrim(x.content))>0 order by x.created_at desc,x.id desc limit 120
 ) m),'[]'::jsonb),'consents',coalesce((select jsonb_agg(jsonb_build_array(c.user_id,c.revision) order by c.user_id)
 from public.pet_consents c join public.room_members rm using(room_id,user_id) where c.room_id=p_room and c.enabled),'[]'::jsonb));
$$;
revoke all on function mailbox_private.pet_context(text,uuid) from public,anon,authenticated;

create or replace function public.mailbox_pet_prepare(p_room text,p_user uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb; fingerprint text; old public.pet_states; job mailbox_private.pet_jobs; today date:=(clock_timestamp() at time zone 'Asia/Shanghai')::date; request uuid; begin
 perform pg_advisory_xact_lock(hashtext('pet:'||p_room));
 if not exists(select 1 from public.room_members where room_id=p_room and user_id=p_user) or not exists(select 1 from public.pet_consents where room_id=p_room and user_id=p_user and enabled) then raise exception 'Consent required' using errcode='42501';end if;
 ctx:=mailbox_private.pet_context(p_room,p_user);fingerprint:=md5(ctx::text);
 if jsonb_array_length(ctx->'messages')=0 then return jsonb_build_object('empty',true);end if;
 select * into old from public.pet_states where room_id=p_room and owner_user_id=p_user;
 if old.source_hash=fingerprint then return jsonb_build_object('cached',true,'state',to_jsonb(old));end if;
 select * into job from mailbox_private.pet_jobs where room_id=p_room and user_id=p_user;
 if job.last_attempt>clock_timestamp()-interval '2 minutes' or (job.attempt_day=today and job.attempts>=12) then raise exception 'Please try later' using errcode='P0001';end if;
 request:=gen_random_uuid();
 insert into mailbox_private.pet_jobs(room_id,user_id,request_id,source_hash,last_attempt,attempt_day,attempts)
 values(p_room,p_user,request,fingerprint,clock_timestamp(),today,1)
 on conflict(room_id,user_id) do update set request_id=request,source_hash=fingerprint,last_attempt=clock_timestamp(),attempt_day=today,
 attempts=case when mailbox_private.pet_jobs.attempt_day=today then mailbox_private.pet_jobs.attempts+1 else 1 end;
 return jsonb_build_object('request',request,'context',ctx->'messages','source_count',jsonb_array_length(ctx->'messages'),'name',old.data->>'name');
end $$;
create or replace function public.mailbox_pet_finish(p_room text,p_user uuid,p_request uuid,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job mailbox_private.pet_jobs; ctx jsonb; result public.pet_states; begin
 perform pg_advisory_xact_lock(hashtext('pet:'||p_room));
 select * into job from mailbox_private.pet_jobs where room_id=p_room and user_id=p_user;
 if job.request_id is distinct from p_request or p_request is null or job.last_attempt<clock_timestamp()-interval '3 minutes' then raise exception 'Request expired' using errcode='40001';end if;
 if not exists(select 1 from public.room_members where room_id=p_room and user_id=p_user) or not exists(select 1 from public.pet_consents where room_id=p_room and user_id=p_user and enabled) then raise exception 'Consent required' using errcode='42501';end if;
 ctx:=mailbox_private.pet_context(p_room,p_user);
 if md5(ctx::text)<>job.source_hash then raise exception 'Memory scope changed' using errcode='40001';end if;
 if jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>16000 then raise exception 'Invalid pet' using errcode='22023';end if;
 insert into public.pet_states(room_id,owner_user_id,data,source_count,source_hash) values(p_room,p_user,p_data,jsonb_array_length(ctx->'messages'),job.source_hash)
 on conflict(room_id,owner_user_id) do update set data=excluded.data,source_count=excluded.source_count,source_hash=excluded.source_hash,generations=public.pet_states.generations+1,updated_at=clock_timestamp() returning * into result;
 update mailbox_private.pet_jobs set request_id=null where room_id=p_room and user_id=p_user;
 return to_jsonb(result);
end $$;
revoke all on function public.mailbox_pet_prepare(text,uuid),public.mailbox_pet_finish(text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.mailbox_pet_prepare(text,uuid),public.mailbox_pet_finish(text,uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';

-- 20261007_notices.sql
-- Generic reminders; no chat, diary or payment text is copied into push payloads.

create table if not exists public.relation_notices(
 id uuid primary key default gen_random_uuid(),room_id text not null references public.mailbox_rooms(room_id),
 user_id uuid not null references auth.users(id),kind text not null check(kind in ('goal','todo','anniversary','pocket','withdraw','listen')),
 source_id text not null,dedupe text not null,created_at timestamptz not null default now(),expires_at timestamptz not null,
 seen_at timestamptz,unique(room_id,user_id,kind,source_id,dedupe)
);
alter table public.relation_notices enable row level security;
revoke all on public.relation_notices from anon,authenticated;
grant select on public.relation_notices to authenticated;
drop policy if exists notices_read on public.relation_notices;
create policy notices_read on public.relation_notices for select to authenticated using(user_id=auth.uid() and mailbox_private.is_member(room_id));
create index if not exists notices_user_expiry on public.relation_notices(user_id,expires_at);

create or replace function mailbox_private.reminder_candidates(p_room text,p_user uuid)
returns table(kind text,source_id text,dedupe text,expires_at timestamptz)
language sql stable security definer set search_path='' as $$
 with day as (select (now() at time zone 'Asia/Shanghai')::date as d), expiry as (select d,(d+1)::timestamp at time zone 'Asia/Shanghai' as expires from day)
 select e.kind,e.id::text,d::text,expires from public.space_entries e cross join expiry
 where e.room_id=p_room and e.event_date<=d and coalesce(e.data->>'remind','true')='true' and (
  (e.kind='todo' and e.owner_user_id=p_user and coalesce(e.data->>'done','false')<>'true') or
  (e.kind='goal' and (e.visibility='shared' or e.owner_user_id=p_user) and not exists(select 1 from public.space_entries c where c.room_id=p_room and c.kind='checkin' and c.data->>'goal'=e.id::text and c.owner_user_id=p_user and c.event_date=d)))
 union all
 select 'anniversary',a.id::text,d::text,expires from public.anniversaries a cross join expiry where a.room_id=p_room and a.remind and
 (a.event_date=d or a.repeat_yearly and a.event_date<=d and (to_char(a.event_date,'MM-DD')=to_char(d,'MM-DD') or to_char(a.event_date,'MM-DD')='02-29' and to_char(d,'MM-DD')='02-28' and extract(day from (date_trunc('month',d)+interval '1 month - 1 day'))=28))
 union all
 select 'pocket',p.id::text,d::text,expires from public.pockets p cross join expiry
 where p.room_id=p_room and p.mode='daily' and (p.created_at at time zone 'Asia/Shanghai')::date<=d
 and coalesce((select sum(case when e.kind='deposit' then e.cents else -e.cents end) from public.pocket_entries e where e.pocket_id=p.id and e.status='settled'),0)<p.target_cents
 and coalesce((select sum(e.cents) from public.pocket_entries e where e.pocket_id=p.id and e.owner_user_id=p_user and e.kind='deposit' and e.status='settled' and (e.created_at at time zone 'Asia/Shanghai')::date=d),0)<p.daily_cents
 and not exists(select 1 from public.pocket_leaves l where l.pocket_id=p.id and l.owner_user_id=p_user and d between l.date_start and l.date_end)
 union all
 select 'withdraw',e.id::text,d::text,expires from public.pocket_entries e cross join expiry where e.room_id=p_room and e.owner_user_id=p_user and e.kind='withdraw' and e.status='pending' and e.available_at<=now();
$$;
revoke all on function mailbox_private.reminder_candidates(text,uuid) from public,anon,authenticated;

create or replace function mailbox_private.queue_reminders(p_room text,p_user uuid)
returns void language sql security definer set search_path='' as $$
 insert into public.relation_notices(room_id,user_id,kind,source_id,dedupe,expires_at)
 select p_room,p_user,c.kind,c.source_id,c.dedupe,c.expires_at from mailbox_private.reminder_candidates(p_room,p_user) c
 where exists(select 1 from public.room_members where room_id=p_room and user_id=p_user)
 on conflict(room_id,user_id,kind,source_id,dedupe) do nothing;
$$;
revoke all on function mailbox_private.queue_reminders(text,uuid) from public,anon,authenticated;

create or replace function public.mailbox_sync_notices(p_room text)
returns jsonb language plpgsql security definer set search_path='' as $$ declare result jsonb; begin
 if not mailbox_private.is_member(p_room) then raise exception 'Membership required' using errcode='42501';end if;
 perform mailbox_private.queue_reminders(p_room,auth.uid());
 select coalesce(jsonb_agg(to_jsonb(n)),'[]'::jsonb) into result from (
 select n.* from public.relation_notices n where n.room_id=p_room and n.user_id=auth.uid() and n.expires_at>now()
 and (n.kind='listen' or exists(select 1 from mailbox_private.reminder_candidates(p_room,auth.uid()) c where (c.kind,c.source_id,c.dedupe)=(n.kind,n.source_id,n.dedupe)))
 order by n.created_at desc limit 100) n;
 return result;
end $$;
create or replace function public.mailbox_read_notice(p_room text,p_id uuid)
returns void language plpgsql security definer set search_path='' as $$ begin
 if not mailbox_private.is_member(p_room) then raise exception 'Membership required' using errcode='42501';end if;
 update public.relation_notices set seen_at=coalesce(seen_at,now()) where room_id=p_room and user_id=auth.uid() and id=p_id;
end $$;
create or replace function public.mailbox_invite_listen(p_room text)
returns integer language plpgsql security definer set search_path='' as $$ declare s public.listen_sessions; count integer; begin
 if not mailbox_private.is_member(p_room) then raise exception 'Membership required' using errcode='42501';end if;
 select * into s from public.listen_sessions where room_id=p_room;
 if s.updated_by is distinct from auth.uid() or s.updated_at<now()-interval '10 minutes' then raise exception 'Current listening session required' using errcode='42501';end if;
 insert into public.relation_notices(room_id,user_id,kind,source_id,dedupe,expires_at)
 select p_room,m.user_id,'listen',s.play_id::text,s.play_id::text,now()+interval '10 minutes' from public.room_members m where m.room_id=p_room and m.user_id<>auth.uid()
 on conflict(room_id,user_id,kind,source_id,dedupe) do nothing;
 get diagnostics count=row_count;return count;
end $$;
revoke all on function public.mailbox_sync_notices(text),public.mailbox_read_notice(text,uuid),public.mailbox_invite_listen(text) from public,anon;
grant execute on function public.mailbox_sync_notices(text),public.mailbox_read_notice(text,uuid),public.mailbox_invite_listen(text) to authenticated;

-- Called by a private scheduled Edge request. Database timing and deduplication are authoritative.
create or replace function public.mailbox_push_jobs()
returns jsonb language plpgsql security definer set search_path='' as $$ declare recipient record; result jsonb; begin
 for recipient in select distinct s.room_id,s.user_id from public.push_subscriptions s join public.room_members m using(room_id,user_id) loop
  perform mailbox_private.queue_reminders(recipient.room_id,recipient.user_id);
 end loop;
 delete from public.relation_notices where expires_at<now()-interval '7 days';
 delete from public.mailbox_push_deliveries where created_at<now()-interval '7 days';
 with candidates as (
  select s.id as subscription_id,s.user_id,s.endpoint,s.p256dh,s.auth,m.room_id,m.id::text as delivery_id,'message'::text as kind,m.id::text as source_id,m.created_at
  from public.messages m join public.push_subscriptions s on s.room_id=m.room_id and s.user_id<>m.author_id
  join public.room_members member on member.room_id=s.room_id and member.user_id=s.user_id
  join public.room_members author on author.room_id=m.room_id and author.user_id=m.author_id
  where m.created_at>now()-interval '24 hours' and m.room_id like 'v2\_%' escape '\'
  union all
  select s.id,s.user_id,s.endpoint,s.p256dh,s.auth,n.room_id,'notice-'||n.id,n.kind,n.id::text,n.created_at
  from public.relation_notices n join public.push_subscriptions s using(room_id,user_id)
  join public.room_members member using(room_id,user_id)
  where n.seen_at is null and n.expires_at>now() and (n.kind='listen' or exists(select 1 from mailbox_private.reminder_candidates(n.room_id,n.user_id) c where (c.kind,c.source_id,c.dedupe)=(n.kind,n.source_id,n.dedupe)))
 ), pending as (
  select c.* from candidates c left join public.mailbox_push_deliveries d on d.subscription_id=c.subscription_id and d.message_id=c.delivery_id
  where d.subscription_id is null or d.status<>'sent' and d.lease_until<now() and d.attempts<5
  order by c.created_at limit 20
 ) select coalesce(jsonb_agg(to_jsonb(pending)),'[]'::jsonb) into result from pending;
 return result;
end $$;
revoke all on function public.mailbox_push_jobs() from public,anon,authenticated;
grant execute on function public.mailbox_push_jobs() to service_role;
notify pgrst,'reload schema';

-- 20261008_api_connections.sql
-- Per-account encrypted API connections. Only authenticated Edge code can read/write.

create table if not exists public.mailbox_api_settings(
 user_id uuid primary key references auth.users(id) on delete cascade,
 connections jsonb not null default '[]',active_id uuid,revision integer not null default 0,
 check(jsonb_typeof(connections)='array' and jsonb_array_length(connections)<=12 and octet_length(connections::text)<=131072)
);
alter table public.mailbox_api_settings enable row level security;
revoke all on public.mailbox_api_settings from public,anon,authenticated;
grant select on public.mailbox_api_settings to service_role;
create table if not exists mailbox_private.api_checks(user_id uuid primary key references auth.users(id) on delete cascade,last_attempt timestamptz,attempt_day date,attempts integer not null default 0);

create or replace function public.mailbox_api_save(p_user uuid,p_connections jsonb,p_active uuid,p_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare current_revision integer;begin
 perform pg_advisory_xact_lock(hashtext('api:'||p_user::text));
 select revision into current_revision from public.mailbox_api_settings where user_id=p_user;
 if coalesce(current_revision,0) is distinct from p_revision then raise exception 'Settings changed' using errcode='40001';end if;
 if p_connections is null or jsonb_typeof(p_connections)<>'array' or jsonb_array_length(p_connections)>12 or octet_length(p_connections::text)>131072 then raise exception 'Invalid connections' using errcode='22023';end if;
 if p_active is not null and not exists(select 1 from jsonb_array_elements(p_connections) p where p->>'id'=p_active::text) then raise exception 'Invalid active connection' using errcode='22023';end if;
 insert into public.mailbox_api_settings(user_id,connections,active_id,revision) values(p_user,p_connections,p_active,p_revision+1)
 on conflict(user_id) do update set connections=excluded.connections,active_id=excluded.active_id,revision=excluded.revision;
 return jsonb_build_object('revision',p_revision+1);
end $$;
create or replace function public.mailbox_api_check_budget(p_user uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare job mailbox_private.api_checks;today date:=current_date;begin
 perform pg_advisory_xact_lock(hashtext('api-check:'||p_user::text));
 select * into job from mailbox_private.api_checks where user_id=p_user;
 if job.last_attempt>clock_timestamp()-interval '10 seconds' or (job.attempt_day=today and job.attempts>=60) then raise exception 'Please try later' using errcode='P0001';end if;
 insert into mailbox_private.api_checks(user_id,last_attempt,attempt_day,attempts) values(p_user,clock_timestamp(),today,1)
 on conflict(user_id) do update set last_attempt=clock_timestamp(),attempt_day=today,attempts=case when mailbox_private.api_checks.attempt_day=today then mailbox_private.api_checks.attempts+1 else 1 end;
 return true;
end $$;
revoke all on function public.mailbox_api_save(uuid,jsonb,uuid,integer),public.mailbox_api_check_budget(uuid) from public,anon,authenticated;
grant execute on function public.mailbox_api_save(uuid,jsonb,uuid,integer),public.mailbox_api_check_budget(uuid) to service_role;

-- Existing consent covered OpenAI only. Never widen it automatically to a new host.
alter table public.pet_consents add column if not exists api_scope text not null default 'https://api.openai.com';
drop function if exists public.mailbox_pet_consent(text,boolean,boolean,date,date);
drop function if exists public.mailbox_pet_prepare(text,uuid);
drop function if exists public.mailbox_pet_finish(text,uuid,uuid,jsonb);
drop function if exists mailbox_private.pet_context(text,uuid);

create or replace function public.mailbox_pet_consent(p_room text,p_enabled boolean,p_auto boolean,p_start date,p_end date default null,p_scope text default 'https://api.openai.com')
returns jsonb language plpgsql security definer set search_path='' as $$ declare r public.pet_consents; begin
 if not mailbox_private.is_member(p_room) then raise exception 'Membership required' using errcode='42501';end if;
 if p_scope is null or length(p_scope)>300 or p_scope !~ '^https://[a-z0-9.-]+(:[0-9]{1,5})?$' then raise exception 'Invalid API scope' using errcode='22023';end if;
 if p_enabled is null or p_auto is null or p_start is null or p_start>'2100-01-01'::date or p_start<'1900-01-01'::date or p_start>p_end then raise exception 'Invalid scope' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtext('pet:'||p_room));
 insert into public.pet_consents(room_id,user_id,enabled,automatic,date_start,date_end,api_scope)
 values(p_room,auth.uid(),p_enabled,p_auto and p_enabled,p_start,p_end,p_scope)
 on conflict(room_id,user_id) do update set enabled=excluded.enabled,automatic=excluded.automatic,date_start=excluded.date_start,date_end=excluded.date_end,api_scope=excluded.api_scope,revision=public.pet_consents.revision+1 returning * into r;
 -- Discard every derivative of the previous scope, including in-flight model requests.
 delete from public.pet_states where room_id=p_room;
 update mailbox_private.pet_jobs set request_id=null,source_hash=null where room_id=p_room;
 return to_jsonb(r);
end $$;
revoke all on function public.mailbox_pet_consent(text,boolean,boolean,date,date,text) from public,anon;
grant execute on function public.mailbox_pet_consent(text,boolean,boolean,date,date,text) to authenticated;

create or replace function mailbox_private.pet_context(p_room text,p_user uuid,p_scope text default 'https://api.openai.com',p_config text default '')
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('api_scope',p_scope,'api_config',p_config,'messages',coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at,m.id) from (
  select x.id::text,x.author_id::text as author,left(x.content,1500) as text,x.created_at
  from public.messages x join public.pet_consents c on c.room_id=x.room_id and c.user_id=x.author_id and c.enabled and c.api_scope=p_scope
  join public.room_members rm on rm.room_id=c.room_id and rm.user_id=c.user_id
  where x.room_id=p_room and x.message_type='text' and nullif(x.import_label,'') is null
  and (x.created_at at time zone 'Asia/Shanghai')::date>=c.date_start
  and (c.date_end is null or (x.created_at at time zone 'Asia/Shanghai')::date<=c.date_end)
  and length(btrim(x.content))>0 order by x.created_at desc,x.id desc limit 120
 ) m),'[]'::jsonb),'consents',coalesce((select jsonb_agg(jsonb_build_array(c.user_id,c.revision) order by c.user_id)
 from public.pet_consents c join public.room_members rm using(room_id,user_id) where c.room_id=p_room and c.enabled and c.api_scope=p_scope),'[]'::jsonb));
$$;
revoke all on function mailbox_private.pet_context(text,uuid,text,text) from public,anon,authenticated;

create or replace function public.mailbox_pet_prepare(p_room text,p_user uuid,p_scope text default 'https://api.openai.com',p_config text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb; fingerprint text; old public.pet_states; job mailbox_private.pet_jobs; today date:=(clock_timestamp() at time zone 'Asia/Shanghai')::date; request uuid; begin
 perform pg_advisory_xact_lock(hashtext('pet:'||p_room));
 if not exists(select 1 from public.room_members where room_id=p_room and user_id=p_user) or not exists(select 1 from public.pet_consents where room_id=p_room and user_id=p_user and enabled and api_scope=p_scope) then raise exception 'Consent required' using errcode='42501';end if;
 ctx:=mailbox_private.pet_context(p_room,p_user,p_scope,p_config);fingerprint:=md5(ctx::text);
 if jsonb_array_length(ctx->'messages')=0 then return jsonb_build_object('empty',true);end if;
 select * into old from public.pet_states where room_id=p_room and owner_user_id=p_user;
 if old.source_hash=fingerprint then return jsonb_build_object('cached',true,'state',to_jsonb(old));end if;
 select * into job from mailbox_private.pet_jobs where room_id=p_room and user_id=p_user;
 if job.last_attempt>clock_timestamp()-interval '2 minutes' or (job.attempt_day=today and job.attempts>=12) then raise exception 'Please try later' using errcode='P0001';end if;
 request:=gen_random_uuid();
 insert into mailbox_private.pet_jobs(room_id,user_id,request_id,source_hash,last_attempt,attempt_day,attempts)
 values(p_room,p_user,request,fingerprint,clock_timestamp(),today,1)
 on conflict(room_id,user_id) do update set request_id=request,source_hash=fingerprint,last_attempt=clock_timestamp(),attempt_day=today,
 attempts=case when mailbox_private.pet_jobs.attempt_day=today then mailbox_private.pet_jobs.attempts+1 else 1 end;
 return jsonb_build_object('request',request,'context',ctx->'messages','source_count',jsonb_array_length(ctx->'messages'),'name',old.data->>'name');
end $$;
create or replace function public.mailbox_pet_finish(p_room text,p_user uuid,p_request uuid,p_data jsonb,p_scope text default 'https://api.openai.com',p_config text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare job mailbox_private.pet_jobs; ctx jsonb; result public.pet_states; begin
 perform pg_advisory_xact_lock(hashtext('pet:'||p_room));
 select * into job from mailbox_private.pet_jobs where room_id=p_room and user_id=p_user;
 if job.request_id is distinct from p_request or p_request is null or job.last_attempt<clock_timestamp()-interval '3 minutes' then raise exception 'Request expired' using errcode='40001';end if;
 if not exists(select 1 from public.room_members where room_id=p_room and user_id=p_user) or not exists(select 1 from public.pet_consents where room_id=p_room and user_id=p_user and enabled and api_scope=p_scope) then raise exception 'Consent required' using errcode='42501';end if;
 ctx:=mailbox_private.pet_context(p_room,p_user,p_scope,p_config);
 if md5(ctx::text)<>job.source_hash then raise exception 'Memory scope changed' using errcode='40001';end if;
 if jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>16000 then raise exception 'Invalid pet' using errcode='22023';end if;
 insert into public.pet_states(room_id,owner_user_id,data,source_count,source_hash) values(p_room,p_user,p_data,jsonb_array_length(ctx->'messages'),job.source_hash)
 on conflict(room_id,owner_user_id) do update set data=excluded.data,source_count=excluded.source_count,source_hash=excluded.source_hash,generations=public.pet_states.generations+1,updated_at=clock_timestamp() returning * into result;
 update mailbox_private.pet_jobs set request_id=null where room_id=p_room and user_id=p_user;
 return to_jsonb(result);
end $$;
revoke all on function public.mailbox_pet_prepare(text,uuid,text,text),public.mailbox_pet_finish(text,uuid,uuid,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.mailbox_pet_prepare(text,uuid,text,text),public.mailbox_pet_finish(text,uuid,uuid,jsonb,text,text) to service_role;
notify pgrst,'reload schema';

commit;
