begin;

-- The database column is the authority, never user_metadata or browser state.
update public.profiles set is_admin=false where is_admin is null;
alter table public.profiles alter column is_admin set default false;
alter table public.profiles alter column is_admin set not null;
create or replace function public.actor_admin() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles
  where id=auth.uid() and is_admin is true and blocked is false)
$$;

create or replace function public.create_user_profile() returns trigger
language plpgsql security definer set search_path='' as $$
declare sponsor uuid;
begin
 select id into sponsor from public.profiles where referral_code=new.raw_user_meta_data->>'referral_code';
 insert into public.profiles(id,full_name,whatsapp,referred_by,contact_consent,is_admin)
 values(new.id,trim(new.raw_user_meta_data->>'full_name'),
  regexp_replace(new.raw_user_meta_data->>'whatsapp','[^0-9]','','g'),sponsor,
  coalesce((new.raw_user_meta_data->>'contact_consent')::boolean,false),false);
 insert into public.wallets(user_id) values(new.id);
 return new;
end; $$;

-- RPC-only access. Even an old PUBLIC grant cannot enable a role change or a
-- direct balance write; existing RLS policies do not override these privileges.
do $$ declare t text;begin
 foreach t in array array['profiles','platform_settings','wallets','products','positions','ledger','commissions','transfers','deposits','withdrawals','webhook_inbox','admin_audit','app_requests'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
 end loop;
end $$;
revoke all on sequence public.admin_audit_id_seq from public,anon,authenticated;
revoke all on function public.actor_admin(),public.create_user_profile() from public,anon,authenticated;
-- Check the role before returning even a cached administrative request. The
-- previous implementation still checks inside the transaction as well.
alter function public.app_action(text,jsonb) rename to app_action_internal;
revoke all on function public.app_action_internal(text,jsonb) from public,anon,authenticated,service_role;
create function public.app_action(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if left(p_action,6)='admin_' and not public.actor_admin() then
  raise exception 'Acesso administrativo negado';
 end if;
 return public.app_action_internal(p_action,p_data);
end; $$;
revoke all on function public.app_action(text,jsonb) from public,anon,authenticated;
grant execute on function public.app_snapshot(boolean),public.app_action(text,jsonb) to authenticated;
grant all on all tables in schema public to service_role;
grant usage,select on all sequences in schema public to service_role;

-- Durable webhook inbox with a lease per delivery. Concurrent/restarted workers
-- may settle the same payment safely, but only the current lease records results.
alter table public.webhook_inbox drop constraint webhook_inbox_status_check;
alter table public.webhook_inbox add constraint webhook_inbox_status_check
 check(status in ('pending','processing','processed','review'));
alter table public.webhook_inbox add column claimed_at timestamptz;
alter table public.webhook_inbox add column claim_token uuid;
create index webhook_inbox_pending on public.webhook_inbox(status,created_at);
create function public.claim_webhook_events(p_limit integer default 20)
returns setof public.webhook_inbox language plpgsql security definer set search_path='' as $$
begin
 return query
 update public.webhook_inbox w
 set status='processing',attempts=w.attempts+1,claimed_at=now(),claim_token=gen_random_uuid()
 where w.delivery_id in (
  select x.delivery_id from public.webhook_inbox x
  where x.status='pending' or (x.status='processing' and x.claimed_at<now()-interval '10 minutes')
  order by x.created_at for update skip locked limit greatest(1,least(coalesce(p_limit,20),50))
 ) returning w.*;
end; $$;
revoke all on function public.claim_webhook_events(integer) from public,anon,authenticated;
grant execute on function public.claim_webhook_events(integer) to service_role;

commit;
