-- Per-account encrypted API connections. Only authenticated Edge code can read/write.
begin;
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
