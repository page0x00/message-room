-- Stable Auth UUID for every NEW message, including legacy rooms. No old row is
-- reassigned, deleted, or inferred from a nickname/device/browser identifier.
begin;
drop policy if exists mailbox_messages_insert_guard on public.messages;
create policy mailbox_messages_insert_guard on public.messages as restrictive for insert to anon,authenticated
 with check (auth.uid() is not null and author_id=auth.uid() and sender=auth.uid()::text
 and (left(room_id,3)<>'v2_' or mailbox_private.is_member(room_id)));
-- Only adjust the compatibility grant that this project created for previously
-- public legacy rooms. Other installations keep their own legacy read policy.
do $$ begin
 if exists(select 1 from pg_policies where schemaname='public' and tablename='messages' and policyname='mailbox_legacy_compat') then
  drop policy mailbox_legacy_compat on public.messages;
  create policy mailbox_legacy_compat on public.messages for all to anon,authenticated
   using(left(room_id,3)<>'v2_') with check(left(room_id,3)<>'v2_' and author_id=auth.uid());
 end if;
end $$;
create or replace function mailbox_private.validate_author_identity()
returns trigger language plpgsql set search_path='' as $$ begin
 if tg_op='INSERT' then
  if auth.uid() is null or new.author_id is distinct from auth.uid() or new.sender is distinct from auth.uid()::text or new.client_nonce is null then
   raise exception 'An authenticated author and nonce are required' using errcode='42501';
  end if;
  new.created_at:=now();
 elsif auth.uid() is not null and (new.author_id is distinct from old.author_id or new.sender is distinct from old.sender or new.room_id is distinct from old.room_id or new.created_at is distinct from old.created_at) then
  raise exception 'Message identity and origin are immutable' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function mailbox_private.validate_author_identity() from public;
drop trigger if exists mailbox_author_identity on public.messages;
create trigger mailbox_author_identity before insert or update on public.messages for each row execute function mailbox_private.validate_author_identity();
notify pgrst,'reload schema';
commit;
