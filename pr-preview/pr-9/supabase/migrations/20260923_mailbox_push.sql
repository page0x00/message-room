-- Additive. No message contents, invite secrets or VAPID private keys in these tables.
begin;
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
