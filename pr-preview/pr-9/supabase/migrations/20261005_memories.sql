-- Views share source messages/diaries. Layout, annotations and personal films contain references.
begin;
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
commit;
