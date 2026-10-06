-- Run AFTER 20260920_mailbox_v2.sql. This never adopts/locks an existing legacy room.
-- v2_ is a reserved namespace: new rooms use an independent, secret invitation token.
begin;

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
commit;
