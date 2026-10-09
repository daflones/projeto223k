begin;

alter table public.products add column coupon_only boolean not null default false;
alter table public.products add constraint products_coupon_only_inactive check(not coupon_only or not active);

create table public.coupons (
 id uuid primary key default gen_random_uuid(), code text not null unique check(code ~ '^[A-Z0-9_-]{8,32}$'),
 creator_id uuid not null references public.profiles(id), message text not null default '' check(length(message)<=500),
 active boolean not null default true, max_total integer not null check(max_total between 1 and 100000),
 max_per_user integer not null check(max_per_user between 1 and 100000),
 max_selections integer not null check(max_selections between 1 and 10),
 expires_at timestamptz, created_at timestamptz not null default now()
);
create table public.coupon_options (
 id uuid primary key default gen_random_uuid(), coupon_id uuid not null references public.coupons(id),
 kind text not null check(kind in ('balance','product','custom')),
 message text not null default '' check(length(message)<=500),
 amount_cents bigint check(amount_cents between 1 and 1000000),
 product_id uuid references public.products(id),
 name text, image text, category text check(category in ('production','distribution')),
 price_cents bigint check(price_cents between 1 and 100000000),
 daily_bps integer check(daily_bps between 0 and 10000), duration_days integer check(duration_days between 1 and 3650),
 return_principal boolean,
 check((kind='balance' and amount_cents is not null and product_id is null and price_cents is null) or
       (kind in ('product','custom') and amount_cents is null and product_id is not null and length(name) between 2 and 120 and image is not null and category is not null and price_cents is not null and daily_bps is not null and duration_days is not null and return_principal is not null))
);
create table public.coupon_redemptions (
 id uuid primary key default gen_random_uuid(), coupon_id uuid not null references public.coupons(id),
 user_id uuid not null references public.profiles(id), request_id uuid not null,
 option_ids uuid[] not null, rewards jsonb not null, result jsonb not null,
 created_at timestamptz not null default now(), unique(user_id,request_id)
);
create index coupon_redemptions_coupon_id on public.coupon_redemptions(coupon_id);
create index coupon_redemptions_user_coupon on public.coupon_redemptions(user_id,coupon_id);

alter table public.coupons enable row level security;
alter table public.coupon_options enable row level security;
alter table public.coupon_redemptions enable row level security;
revoke all on public.coupons,public.coupon_options,public.coupon_redemptions from public,anon,authenticated;
grant all on public.coupons,public.coupon_options,public.coupon_redemptions to service_role;

create function public.coupon_admin_save(p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); c public.coupons; o jsonb; prod public.products; pid uuid; options jsonb; k text; count_options integer;
begin
 if not public.actor_admin() then raise exception 'Acesso administrativo negado'; end if;
 if p_data ? 'id' then
  if p_data - 'id' - 'active' <> '{}'::jsonb or jsonb_typeof(p_data->'active') <> 'boolean' then raise exception 'Apenas o estado ativo pode ser alterado'; end if;
  update public.coupons set active=(p_data->>'active')::boolean where id=(p_data->>'id')::uuid returning * into c;
  if not found then raise exception 'Cupom inexistente'; end if;
  insert into public.admin_audit(admin_id,action,details) values(uid,'coupon_toggle',jsonb_build_object('id',c.id,'code',c.code,'active',c.active));
 else
  options:=p_data->'options'; count_options:=case when jsonb_typeof(options)='array' then jsonb_array_length(options) else 0 end;
  if count_options<1 or count_options>10 then raise exception 'Escolha de 1 a 10 opções'; end if;
  if coalesce(p_data->>'code','') !~ '^[A-Z0-9_-]{8,32}$' then raise exception 'Código inválido'; end if;
  if (p_data->>'max_selections')::integer not between 1 and count_options then raise exception 'Seleções inválidas'; end if;
  insert into public.coupons(code,creator_id,message,active,max_total,max_per_user,max_selections,expires_at)
  values(p_data->>'code',uid,coalesce(p_data->>'message',''),coalesce((p_data->>'active')::boolean,true),
   (p_data->>'max_total')::integer,(p_data->>'max_per_user')::integer,(p_data->>'max_selections')::integer,(p_data->>'expires_at')::timestamptz) returning * into c;
  for o in select value from jsonb_array_elements(options) loop
   k:=o->>'kind';
   if k='balance' then
    if (o->>'amount_cents')::bigint not between 1 and 1000000 then raise exception 'Saldo inválido'; end if;
    insert into public.coupon_options(coupon_id,kind,message,amount_cents) values(c.id,k,coalesce(o->>'message',''),(o->>'amount_cents')::bigint);
   elsif k in ('product','custom') then
    if k='product' then
     select * into prod from public.products where id=(o->>'product_id')::uuid and not coupon_only;
     if not found then raise exception 'Produto inválido'; end if;
     if o ? 'price_cents' and (o->>'price_cents')::bigint is distinct from prod.price_cents then raise exception 'Preço do produto inválido'; end if;
    else
     if nullif(o->>'name','') is null or coalesce(o->>'image','') !~ '^(/assets/[^<>]+|https://[^<>]+)$' or o->>'category' not in ('production','distribution') or (o->>'price_cents')::bigint not between 1 and 100000000 then raise exception 'Produto exclusivo inválido'; end if;
     insert into public.products(name,category,image,price_cents,daily_bps,duration_days,active,coupon_only)
     values(o->>'name',o->>'category',o->>'image',(o->>'price_cents')::bigint,(o->>'daily_bps')::integer,(o->>'duration_days')::integer,false,true) returning * into prod;
    end if;
    if ((o->>'daily_bps')::integer between 0 and 10000) is not true or ((o->>'duration_days')::integer between 1 and 3650) is not true or jsonb_typeof(o->'return_principal') is distinct from 'boolean' then raise exception 'Condições do produto obrigatórias'; end if;
    insert into public.coupon_options(coupon_id,kind,message,product_id,name,image,category,price_cents,daily_bps,duration_days,return_principal)
    values(c.id,k,coalesce(o->>'message',''),prod.id,prod.name,prod.image,prod.category,prod.price_cents,(o->>'daily_bps')::integer,(o->>'duration_days')::integer,(o->>'return_principal')::boolean);
   else raise exception 'Tipo de prêmio inválido'; end if;
  end loop;
  insert into public.admin_audit(admin_id,action,details) values(uid,'coupon_create',jsonb_build_object('id',c.id,'code',c.code,'options',options));
 end if;
 return jsonb_build_object('id',c.id,'code',c.code);
end; $$;

create function public.coupon_admin_list() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not public.actor_admin() then raise exception 'Acesso administrativo negado'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'code',c.code,'active',c.active,'message',c.message,'max_total',c.max_total,'max_per_user',c.max_per_user,'max_selections',c.max_selections,'expires_at',c.expires_at,'redeemed_count',(select count(*) from public.coupon_redemptions r where r.coupon_id=c.id),'options',coalesce((select jsonb_agg(to_jsonb(o)-'coupon_id' order by o.id) from public.coupon_options o where o.coupon_id=c.id),'[]'::jsonb)) order by c.created_at desc) from public.coupons c),'[]'::jsonb);
end; $$;

create function public.coupon_preview(p_code text) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); c public.coupons; used integer; total integer;
begin
 if uid is null then raise exception 'Autenticação necessária'; end if;
 if not exists(select 1 from public.profiles where id=uid and not blocked) then raise exception 'Conta indisponível'; end if;
 select * into c from public.coupons where code=upper(trim(p_code)) and active and (expires_at is null or expires_at>now());
 if not found then raise exception 'Cupom indisponível'; end if;
 select count(*) into used from public.coupon_redemptions where coupon_id=c.id and user_id=uid;
 select count(*) into total from public.coupon_redemptions where coupon_id=c.id;
 if total>=c.max_total or used>=c.max_per_user then raise exception 'Limite de resgates atingido'; end if;
 return jsonb_build_object('id',c.id,'code',c.code,'message',c.message,'active',c.active,'max_total',c.max_total,'max_per_user',c.max_per_user,'max_selections',c.max_selections,'expires_at',c.expires_at,'redeemed_count',total,'remaining_user',greatest(0,least(c.max_per_user-used,c.max_total-total)),'options',coalesce((select jsonb_agg(to_jsonb(o)-'coupon_id' order by o.id) from public.coupon_options o where o.coupon_id=c.id),'[]'::jsonb));
end; $$;

create function public.coupon_redeem(p_code text,p_option_ids uuid[],p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); c public.coupons; previous public.coupon_redemptions; o public.coupon_options; selected uuid[]; option_id uuid; rewards jsonb:='[]'::jsonb; reward jsonb; result jsonb; redemption_id uuid:=gen_random_uuid(); position_id uuid; snapshots jsonb:='[]'::jsonb;
begin
 if uid is null then raise exception 'Autenticação necessária'; end if;
 if p_request_id is null or p_option_ids is null then raise exception 'Identificador e escolhas obrigatórios'; end if;
 if array_length(p_option_ids,1) is null or array_length(p_option_ids,1)>10 or array_position(p_option_ids,null) is not null then raise exception 'Escolhas inválidas'; end if;
 select array_agg(id order by id) into selected from unnest(p_option_ids) id;
 if (select count(distinct id) from unnest(p_option_ids) id)<>array_length(p_option_ids,1) then raise exception 'Opções repetidas'; end if;
 perform 1 from public.profiles where id=uid and not blocked for update;
 if not found then raise exception 'Conta indisponível'; end if;
 select * into previous from public.coupon_redemptions where user_id=uid and request_id=p_request_id;
 if found then
  if previous.option_ids<>selected or previous.coupon_id is distinct from (select id from public.coupons where code=upper(trim(p_code))) then raise exception 'Identificador reutilizado'; end if;
  return previous.result;
 end if;
 select * into c from public.coupons where code=upper(trim(p_code)) for update;
 if not found or not c.active or (c.expires_at is not null and c.expires_at<=now()) then raise exception 'Cupom indisponível'; end if;
 if array_length(selected,1)>c.max_selections then raise exception 'Seleções excedidas'; end if;
 if (select count(*) from public.coupon_redemptions where coupon_id=c.id)>=c.max_total then raise exception 'Cupom esgotado'; end if;
 if (select count(*) from public.coupon_redemptions where coupon_id=c.id and user_id=uid)>=c.max_per_user then raise exception 'Limite por conta atingido'; end if;
 if (select count(*) from public.coupon_options where coupon_id=c.id and id=any(selected))<>array_length(selected,1) then raise exception 'Opção inválida'; end if;
 for option_id in select unnest(selected) loop
  select * into o from public.coupon_options where id=option_id and coupon_id=c.id;
  if o.kind='balance' then
   perform public.wallet_delta(uid,'coupon',o.amount_cents,0,'coupon:'||redemption_id||':'||o.id,'Cupom '||c.code);
   reward:=jsonb_build_object('kind','balance','name','Saldo','amount_cents',o.amount_cents,'message',o.message);
   snapshots:=snapshots||jsonb_build_array(jsonb_build_object('option_id',o.id,'kind',o.kind,'amount_cents',o.amount_cents,'message',o.message));
  else
   insert into public.positions(user_id,payer_id,product_id,name,category,image,principal_cents,daily_bps,duration_days,return_principal)
   values(uid,c.creator_id,o.product_id,o.name,o.category,o.image,o.price_cents,o.daily_bps,o.duration_days,o.return_principal) returning id into position_id;
   reward:=jsonb_build_object('kind',o.kind,'name',o.name,'message',o.message);
   snapshots:=snapshots||jsonb_build_array(jsonb_build_object('option_id',o.id,'kind',o.kind,'product_id',o.product_id,'position_id',position_id,'name',o.name,'category',o.category,'image',o.image,'price_cents',o.price_cents,'daily_bps',o.daily_bps,'duration_days',o.duration_days,'return_principal',o.return_principal,'message',o.message));
  end if;
  rewards:=rewards||jsonb_build_array(reward);
 end loop;
 result:=jsonb_build_object('id',redemption_id,'code',c.code,'message',c.message,'rewards',rewards);
 insert into public.coupon_redemptions(id,coupon_id,user_id,request_id,option_ids,rewards,result) values(redemption_id,c.id,uid,p_request_id,selected,snapshots,result);
 return result;
end; $$;

revoke all on function public.coupon_admin_save(jsonb),public.coupon_admin_list(),public.coupon_preview(text),public.coupon_redeem(text,uuid[],uuid) from public,anon,authenticated;
grant execute on function public.coupon_admin_save(jsonb),public.coupon_admin_list(),public.coupon_preview(text),public.coupon_redeem(text,uuid[],uuid) to authenticated;
grant execute on function public.coupon_admin_save(jsonb),public.coupon_admin_list(),public.coupon_preview(text),public.coupon_redeem(text,uuid[],uuid) to service_role;

do $$
declare definition text; previous text := 'where active or public.actor_admin()'; replacement text := 'where not x.coupon_only and (active or public.actor_admin())';
begin
 definition:=pg_get_functiondef('public.app_snapshot(boolean)'::regprocedure);
 if length(definition)-length(replace(definition,previous,''))<>length(previous) then raise exception 'Versão inesperada de app_snapshot; migração recusada'; end if;
 execute replace(definition,previous,replacement);
end $$;

commit;
