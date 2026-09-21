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

commit;
