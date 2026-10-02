-- Music metadata, independent likes and measured simultaneous playback. No audio upload.
begin;
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
commit;
