-- Daily records and pocket bookkeeping. No money is held or transferred here.
begin;
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
commit;
