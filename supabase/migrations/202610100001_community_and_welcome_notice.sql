begin;

do $$ begin
  if to_regclass('public.coupon_redemptions') is null
     or to_regprocedure('public.coupon_preview(text)') is null then
    raise exception 'Aplique a migração 202610090002_coupons.sql antes desta atualização';
  end if;
end $$;

-- Update only the community link; balances, products and withdrawal settings
-- remain under the existing administration rules.
with previous as (
  select whatsapp_group from public.platform_settings where id=1
), changed as (
  update public.platform_settings
  set whatsapp_group='https://chat.whatsapp.com/BaQG9FSKZNYJXnJxNzVcyx'
  where id=1 and whatsapp_group is distinct from 'https://chat.whatsapp.com/BaQG9FSKZNYJXnJxNzVcyx'
  returning id
)
insert into public.admin_audit(admin_id,action,details)
select null,'community_group_update',jsonb_build_object(
  'previous_whatsapp_group',previous.whatsapp_group,
  'whatsapp_group','https://chat.whatsapp.com/BaQG9FSKZNYJXnJxNzVcyx'
) from previous where exists(select 1 from changed);

-- Read-only, account-scoped status. Never accept a user_id from the browser.
-- Keep redemption and reward creation in the existing transactional RPCs.
create or replace function public.welcome_coupon_status()
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  uid uuid:=auth.uid();
  already_redeemed boolean;
  preview jsonb;
begin
  if uid is null then raise exception 'Autenticação necessária'; end if;
  if not exists(select 1 from public.profiles where id=uid and not blocked) then
    raise exception 'Conta indisponível';
  end if;
  select exists(
    select 1 from public.coupon_redemptions r
    join public.coupons c on c.id=r.coupon_id
    where r.user_id=uid and c.code='ELETRIFY'
  ) into already_redeemed;
  if already_redeemed then
    return jsonb_build_object('code','ELETRIFY','redeemed',true,'coupon',null);
  end if;
  begin
    preview:=public.coupon_preview('ELETRIFY');
  exception when raise_exception then
    -- Inactive, missing, expired or exhausted coupons are not advertised.
    preview:=null;
  end;
  return jsonb_build_object('code','ELETRIFY','redeemed',false,'coupon',preview);
end; $$;

revoke all on function public.welcome_coupon_status() from public,anon,authenticated;
grant execute on function public.welcome_coupon_status() to authenticated,service_role;

commit;
