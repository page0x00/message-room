begin;
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
commit;
