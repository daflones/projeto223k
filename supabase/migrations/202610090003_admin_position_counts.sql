begin;

create function public.admin_active_position_counts() returns jsonb language sql stable security definer set search_path='' as $$
 with coupon_positions as (
  select distinct (choice.value->>'position_id')::uuid as id
  from public.coupon_redemptions r
  cross join lateral jsonb_array_elements(r.rewards) as choice(value)
  where choice.value ? 'position_id'
 ), classified as (
  select p.id, c.id is not null as from_coupon,
   p.user_id=p.payer_id and exists (
    select 1 from public.ledger l
    where l.user_id=p.user_id and l.kind='purchase' and l.created_at=p.created_at
      and l.event_key like 'purchase:%'
   ) as own_purchase
  from public.positions p left join coupon_positions c on c.id=p.id
  where p.status='active'
 )
 select jsonb_build_object(
  'coupon', count(*) filter(where from_coupon),
  'purchased', count(*) filter(where own_purchase and not from_coupon)
 ) from classified
$$;
revoke all on function public.admin_active_position_counts() from public,anon,authenticated,service_role;

do $$
declare definition text;
 previous text := 'end if; return result;';
 replacement text := 'result:=jsonb_set(result,''{admin,position_counts}'',public.admin_active_position_counts()); end if; return result;';
begin
 definition:=pg_get_functiondef('public.app_snapshot(boolean)'::regprocedure);
 if length(definition)-length(replace(definition,previous,''))<>length(previous) then
  raise exception 'Versão inesperada de app_snapshot; migração recusada';
 end if;
 execute replace(definition,previous,replacement);
end $$;

commit;
