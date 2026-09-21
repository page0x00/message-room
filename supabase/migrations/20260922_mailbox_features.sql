-- Run after 20260920 and 20260921. Additive: original messages are never deleted.
begin;
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
commit;
