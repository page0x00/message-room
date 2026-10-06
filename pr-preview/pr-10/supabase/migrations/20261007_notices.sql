-- Generic reminders; no chat, diary or payment text is copied into push payloads.
begin;
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
commit;
