begin;

do $$ begin
 if to_regprocedure('public.admin_active_position_counts()') is null or to_regclass('public.coupon_redemptions') is null then
  raise exception 'Aplique as migrações de cupons e 202610090003_admin_position_counts.sql antes desta atualização';
 end if;
end $$;

-- Read-only admin projections. Client roles retain no direct table access.
create index if not exists profiles_admin_page on public.profiles(created_at desc,id desc);
create index if not exists positions_admin_page on public.positions(created_at desc,id desc);
create index if not exists withdrawals_admin_page on public.withdrawals(created_at desc,id desc);
create index if not exists deposits_admin_page on public.deposits(created_at desc,id desc);
create index if not exists commissions_admin_user_page on public.commissions(user_id,created_at desc,id desc);
create index if not exists coupons_admin_page on public.coupons(created_at desc,id desc);
create index if not exists coupon_redemptions_admin_coupon on public.coupon_redemptions(coupon_id);
create index if not exists webhook_inbox_admin_page on public.webhook_inbox(created_at desc,delivery_id desc);

create or replace function public.admin_team_members(p_root uuid)
returns table(user_id uuid,level integer) language sql stable security definer set search_path='' as $$
 with recursive team as (
  select p.id,1 as depth,array[p_root,p.id] as visited
  from public.profiles p where p.referred_by=p_root and p.id<>p_root
  union all
  select p.id,t.depth+1,t.visited||p.id
  from public.profiles p join team t on p.referred_by=t.id
  where t.depth<3 and not p.id=any(t.visited)
 ) select id,depth from team
$$;
revoke all on function public.admin_team_members(uuid) from public,anon,authenticated,service_role;

create or replace function public.admin_overview()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.actor_admin() then raise exception 'Acesso administrativo negado'; end if;
 return jsonb_build_object(
  'users_count',(select count(*) from public.profiles),
  'position_counts',public.admin_active_position_counts(),
  'available_cents',(select coalesce(sum(available_cents),0) from public.wallets),
  'reserved_cents',(select coalesce(sum(reserved_cents),0) from public.wallets),
  'pending_withdrawals',(select count(*) from public.withdrawals where status='requested'),
  'pending_withdrawal_cents',(select coalesce(sum(amount_cents),0) from public.withdrawals where status='requested'),
  'completed_deposits',(select count(*) from public.deposits where status='completed'),
  'review_webhooks',(select count(*) from public.webhook_inbox where status='review')
 );
end; $$;

create or replace function public.admin_page(
 p_section text,p_page integer default 1,p_page_size integer default 20,
 p_search text default '',p_status text default '',p_user_id uuid default null,p_level integer default 1
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 source text; term text; state text:=coalesce(p_status,'');
 total bigint; pages integer; current_page integer;
 size integer:=greatest(1,least(coalesce(p_page_size,20),100));
 items jsonb;
begin
 if not public.actor_admin() then raise exception 'Acesso administrativo negado'; end if;
 if length(coalesce(p_search,''))>200 then raise exception 'Busca limitada a 200 caracteres'; end if;
 if p_user_id is not null and not exists(select 1 from public.profiles where id=p_user_id) then
  raise exception 'Usuário não encontrado';
 end if;
 term:='%'||replace(replace(replace(trim(coalesce(p_search,'')),chr(92),chr(92)||chr(92)),'%',chr(92)||'%'),'_',chr(92)||'_')||'%';
 -- Only fixed SQL fragments are selected. All filters are bound parameters.
 case p_section
 when 'users' then source:=$q$
  select to_jsonb(p)||jsonb_build_object('email',a.email,'wallet',jsonb_build_object('available_cents',coalesce(w.available_cents,0),'reserved_cents',coalesce(w.reserved_cents,0)),
   'commissions_cents',(select coalesce(sum(c.amount_cents),0) from public.commissions c where c.user_id=p.id)) item,
   p.created_at sort_at,p.id::text sort_id
  from public.profiles p left join public.wallets w on w.user_id=p.id left join auth.users a on a.id=p.id
  where (p.full_name ilike $1 or coalesce(a.email,'') ilike $1 or p.whatsapp ilike $1 or p.id::text ilike $1)
   and ($2='' or ($2='blocked' and p.blocked) or ($2='active' and not p.blocked) or ($2='admin' and p.is_admin))
 $q$;
 when 'products' then source:=$q$
  select to_jsonb(p) item,p.created_at sort_at,p.id::text sort_id from public.products p
  where (p.name ilike $1 or p.description ilike $1)
   and ($2='' or ($2='active' and p.active) or ($2='paused' and not p.active) or p.category=$2)
 $q$;
 when 'positions' then source:=$q$
  select to_jsonb(p)||jsonb_build_object('user_name',u.full_name,'user_whatsapp',u.whatsapp,
   'source',case when exists(select 1 from public.coupon_redemptions r where r.rewards @> jsonb_build_array(jsonb_build_object('position_id',p.id::text))) then 'coupon'
     when p.user_id<>p.payer_id then 'gift'
     when exists(select 1 from public.ledger l where l.user_id=p.user_id and l.kind='purchase' and l.created_at=p.created_at and l.event_key like 'purchase:%') then 'purchase'
     else 'grant' end) item,p.created_at sort_at,p.id::text sort_id
  from public.positions p join public.profiles u on u.id=p.user_id
  where (p.name ilike $1 or u.full_name ilike $1 or u.whatsapp ilike $1)
   and ($2='' or p.status=$2) and ($3::uuid is null or p.user_id=$3)
 $q$;
 when 'withdrawals' then source:=$q$
  select to_jsonb(w)||jsonb_build_object('user_name',u.full_name,'user_whatsapp',u.whatsapp) item,
   w.created_at sort_at,w.id::text sort_id
  from public.withdrawals w join public.profiles u on u.id=w.user_id
  where (u.full_name ilike $1 or u.whatsapp ilike $1 or w.pix_key ilike $1 or w.id::text ilike $1)
   and ($2='' or w.status=$2) and ($3::uuid is null or w.user_id=$3)
 $q$;
 when 'deposits' then source:=$q$
  select to_jsonb(d)||jsonb_build_object('user_name',u.full_name,'user_whatsapp',u.whatsapp) item,
   d.created_at sort_at,d.id::text sort_id
  from public.deposits d join public.profiles u on u.id=d.user_id
  where (u.full_name ilike $1 or u.whatsapp ilike $1 or d.id::text ilike $1 or coalesce(d.provider_id,'') ilike $1)
   and ($2='' or d.status=$2) and ($3::uuid is null or d.user_id=$3)
 $q$;
 when 'coupons' then source:=$q$
  select to_jsonb(c)||jsonb_build_object('redeemed_count',(select count(*) from public.coupon_redemptions r where r.coupon_id=c.id),
   'options',coalesce((select jsonb_agg(to_jsonb(o)-'coupon_id' order by o.id) from public.coupon_options o where o.coupon_id=c.id),'[]'::jsonb)) item,
   c.created_at sort_at,c.id::text sort_id from public.coupons c
  where (c.code ilike $1 or c.message ilike $1)
   and ($2='' or ($2='active' and c.active) or ($2='paused' and not c.active))
 $q$;
 when 'audit' then source:=$q$
  select to_jsonb(a)||jsonb_build_object('admin_name',u.full_name) item,a.created_at sort_at,lpad(a.id::text,20,'0') sort_id
  from public.admin_audit a left join public.profiles u on u.id=a.admin_id
  where a.action ilike $1 or a.details::text ilike $1 or coalesce(u.full_name,'') ilike $1
 $q$;
 when 'webhooks' then source:=$q$
  select jsonb_build_object('delivery_id',w.delivery_id,'event',w.event,'status',w.status,'last_error',w.last_error,'created_at',w.created_at,'attempts',w.attempts) item,
   w.created_at sort_at,w.delivery_id sort_id from public.webhook_inbox w
  where (w.delivery_id ilike $1 or w.event ilike $1 or coalesce(w.last_error,'') ilike $1) and ($2='' or w.status=$2)
 $q$;
 when 'commissions' then source:=$q$
  select to_jsonb(c)||jsonb_build_object('source_name',u.full_name,'source_whatsapp',u.whatsapp,'product_name',p.name) item,
   c.created_at sort_at,c.id::text sort_id
  from public.commissions c join public.profiles u on u.id=c.source_user_id join public.positions p on p.id=c.position_id
  where (u.full_name ilike $1 or u.whatsapp ilike $1 or p.name ilike $1)
   and ($3::uuid is null or c.user_id=$3) and ($2='' or c.level::text=$2)
 $q$;
 when 'affiliates' then
  if p_user_id is null then raise exception 'Informe o usuário da equipe'; end if;
  if p_level is null or p_level not between 1 and 3 then raise exception 'Nível inválido'; end if;
  source:=$q$
   select jsonb_build_object('id',u.id,'full_name',u.full_name,'whatsapp',u.whatsapp,'blocked',u.blocked,'created_at',u.created_at,'level',t.level,
    'active',exists(select 1 from public.positions p where p.user_id=u.id and p.status='active'),
    'products_count',(select count(*) from public.positions p where p.user_id=u.id),
    'products',coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc,p.id desc) from (select id,name,status,principal_cents,earned_cents,created_at from public.positions where user_id=u.id order by created_at desc,id desc limit 3) p),'[]'::jsonb),
    'commission_cents',(select coalesce(sum(c.amount_cents),0) from public.commissions c where c.user_id=$3 and c.source_user_id=u.id)) item,
    u.created_at sort_at,u.id::text sort_id
   from public.admin_team_members($3) t join public.profiles u on u.id=t.user_id
   where t.level=$4 and (u.full_name ilike $1 or u.whatsapp ilike $1)
    and ($2='' or ($2='active' and exists(select 1 from public.positions p where p.user_id=u.id and p.status='active'))
      or ($2='inactive' and not exists(select 1 from public.positions p where p.user_id=u.id and p.status='active')))
  $q$;
 else raise exception 'Lista administrativa inválida';
 end case;
 execute 'select count(*) from ('||source||') filtered' into total using term,state,p_user_id,p_level;
 pages:=greatest(1,ceil(total::numeric/size)::integer);
 current_page:=greatest(1,least(coalesce(p_page,1),pages));
 execute 'select coalesce(jsonb_agg(item order by sort_at desc nulls last,sort_id desc),''[]''::jsonb) from
  (select * from ('||source||') filtered order by sort_at desc nulls last,sort_id desc limit $5 offset $6) paged'
 into items using term,state,p_user_id,p_level,size,(current_page-1)::bigint*size;
 return jsonb_build_object('items',items,'total',total,'page',current_page,'page_size',size,'total_pages',pages);
end; $$;

create or replace function public.admin_user_profile(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.actor_admin() then raise exception 'Acesso administrativo negado'; end if;
 select jsonb_build_object(
  'user',to_jsonb(u)||jsonb_build_object('email',a.email,'email_confirmed_at',a.email_confirmed_at,'wallet',jsonb_build_object('available_cents',coalesce(w.available_cents,0),'reserved_cents',coalesce(w.reserved_cents,0))),
  'sponsor',(select jsonb_build_object('id',s.id,'full_name',s.full_name,'whatsapp',s.whatsapp) from public.profiles s where s.id=u.referred_by),
  'products_count',(select count(*) from public.positions p where p.user_id=u.id),
  'active_products',(select count(*) from public.positions p where p.user_id=u.id and p.status='active'),
  'invested_cents',(select coalesce(sum(principal_cents),0) from public.positions p where p.user_id=u.id and p.status='active'),
  'earned_cents',(select coalesce(sum(earned_cents),0) from public.positions p where p.user_id=u.id),
  'commissions_cents',(select coalesce(sum(amount_cents),0) from public.commissions c where c.user_id=u.id),
  'levels',(select jsonb_agg(jsonb_build_object('level',n,'total',(select count(*) from public.admin_team_members(u.id) t where t.level=n),
   'active',(select count(*) from public.admin_team_members(u.id) t where t.level=n and exists(select 1 from public.positions p where p.user_id=t.user_id and p.status='active')),
   'commissions_cents',(select coalesce(sum(amount_cents),0) from public.commissions c where c.user_id=u.id and c.level=n)) order by n) from generate_series(1,3) n)
 ) into result from public.profiles u left join auth.users a on a.id=u.id left join public.wallets w on w.user_id=u.id where u.id=p_user_id;
 if result is null then raise exception 'Usuário não encontrado'; end if;
 return result;
end; $$;

revoke all on function public.admin_overview(),public.admin_page(text,integer,integer,text,text,uuid,integer),public.admin_user_profile(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_overview(),public.admin_page(text,integer,integer,text,text,uuid,integer),public.admin_user_profile(uuid) to authenticated;

commit;
