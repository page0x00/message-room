-- Browser-to-provider calls: these RPCs receive no API key or raw profile.
-- Keep the existing author consent, request budget and private result ownership.
begin;
create or replace function public.mailbox_pet_prepare_direct(p_room text,p_scope text,p_config text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not mailbox_private.is_member(p_room) then raise exception 'Membership required' using errcode='42501';end if;
 if p_config is null or p_config !~ '^[a-f0-9]{64}$' or p_scope is null or length(p_scope)>300 or p_scope !~ '^https://[a-z0-9.-]+(:[0-9]{1,5})?$' then raise exception 'Invalid connection scope' using errcode='22023';end if;
 return public.mailbox_pet_prepare(p_room,auth.uid(),p_scope,'direct:'||p_config);
end $$;

create or replace function public.mailbox_pet_finish_direct(p_room text,p_scope text,p_config text,p_request uuid,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb; item jsonb; source jsonb;begin
 if auth.uid() is null or not mailbox_private.is_member(p_room) then raise exception 'Membership required' using errcode='42501';end if;
 if p_config is null or p_config !~ '^[a-f0-9]{64}$' or p_scope is null or length(p_scope)>300 or p_scope !~ '^https://[a-z0-9.-]+(:[0-9]{1,5})?$' then raise exception 'Invalid connection scope' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtext('pet:'||p_room));
 if p_request is null or not exists(select 1 from mailbox_private.pet_jobs where room_id=p_room and user_id=auth.uid() and request_id=p_request and last_attempt>=clock_timestamp()-interval '3 minutes') then raise exception 'Request expired' using errcode='40001';end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>16000
 or (p_data-array['name','mood','line','traits','memories'])<>'{}'::jsonb
 or jsonb_typeof(p_data->'name') is distinct from 'string' or length(p_data->>'name') not between 1 and 24
 or jsonb_typeof(p_data->'line') is distinct from 'string' or length(p_data->>'line') not between 1 and 160
 or coalesce(p_data->>'mood','') not in ('calm','curious','happy','sleepy')
 or jsonb_typeof(p_data->'traits') is distinct from 'array' or jsonb_typeof(p_data->'memories') is distinct from 'array'
 then raise exception 'Invalid pet result' using errcode='22023';end if;
 if jsonb_array_length(p_data->'traits')>4 or jsonb_array_length(p_data->'memories')>5 then raise exception 'Invalid pet result' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(p_data->'traits') loop
  if jsonb_typeof(item)<>'string' or length(item#>>'{}') not between 1 and 24 then raise exception 'Invalid trait' using errcode='22023';end if;
 end loop;
 ctx:=mailbox_private.pet_context(p_room,auth.uid(),p_scope,'direct:'||p_config);
 for item in select value from jsonb_array_elements(p_data->'memories') loop
  if jsonb_typeof(item)<>'object' or jsonb_typeof(item->'text') is distinct from 'string' or length(item->>'text') not between 1 and 200
  or jsonb_typeof(item->'sources') is distinct from 'array' or (item-array['text','sources'])<>'{}'::jsonb then raise exception 'Invalid memory' using errcode='22023';end if;
  if jsonb_array_length(item->'sources') not between 1 and 120 then raise exception 'Invalid sources' using errcode='22023';end if;
  for source in select value from jsonb_array_elements(item->'sources') loop
   if jsonb_typeof(source)<>'string' or not exists(select 1 from jsonb_array_elements(ctx->'messages') m where m->>'id'=source#>>'{}') then raise exception 'Unconsented source' using errcode='22023';end if;
  end loop;
 end loop;
 return public.mailbox_pet_finish(p_room,auth.uid(),p_request,p_data,p_scope,'direct:'||p_config);
end $$;
revoke all on function public.mailbox_pet_prepare_direct(text,text,text),public.mailbox_pet_finish_direct(text,text,text,uuid,jsonb) from public,anon;
grant execute on function public.mailbox_pet_prepare_direct(text,text,text),public.mailbox_pet_finish_direct(text,text,text,uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
