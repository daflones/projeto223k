-- ELETRIFY: instalação inicial completa no Supabase SQL Editor.
-- Gerado por npm run build:sql a partir das migrações. Não editar esta cópia.
-- Banco já instalado: aplicar apenas as migrações pendentes; veja docs/INSTALACAO-SUPABASE.md.
-- Não concede admin, não configura segredos nem agenda o cron.
begin;
do $$ begin
 if to_regclass('auth.users') is null then
  raise exception 'Execute no banco Supabase: auth.users não existe';
 end if;
 if to_regclass('public.platform_settings') is not null then
  raise exception 'Eletrify já instalada. Aplique apenas migrações pendentes';
 end if;
end $$;

-- Migração: 202610060001_platform.sql
create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 full_name text not null check(char_length(full_name) between 2 and 120),
 whatsapp text not null check(whatsapp ~ '^[0-9]{10,15}$'),
 referral_code text not null unique default replace(gen_random_uuid()::text,'-',''),
 referred_by uuid references public.profiles(id), created_at timestamptz not null default now(),
 check(referred_by is distinct from id)
);
alter table public.profiles add column if not exists avatar_url text not null default '';
alter table public.profiles add column if not exists is_admin boolean not null default false;
alter table public.profiles add column if not exists blocked boolean not null default false;
alter table public.profiles add column if not exists contact_consent boolean not null default false;
alter table public.profiles add column if not exists first_purchase_at timestamptz;
create table public.platform_settings(
 id integer primary key default 1 check(id=1), withdrawals_enabled boolean not null default false,
 production_enabled boolean not null default true,
 commission_bps integer[] not null default '{1500,0,0}',
 whatsapp_group text not null default '', return_principal boolean not null default false,
 constraint commission_rates check(array_length(commission_bps,1)=3 and commission_bps[1]>=0 and commission_bps[2]>=0 and commission_bps[3]>=0 and commission_bps[1]+commission_bps[2]+commission_bps[3]<=10000)
);
insert into public.platform_settings(id) values(1);
create table public.wallets(user_id uuid primary key references public.profiles(id), available_cents bigint not null default 0 check(available_cents>=0), reserved_cents bigint not null default 0 check(reserved_cents>=0));
create table public.products(id uuid primary key default gen_random_uuid(), name text not null check(char_length(name) between 2 and 120), category text not null check(category in ('production','distribution')), description text not null default '', image text not null, price_cents bigint not null check(price_cents>0 and price_cents<=100000000), daily_bps integer not null default 0 check(daily_bps between 0 and 10000), duration_days integer not null default 30 check(duration_days between 1 and 3650), active boolean not null default false, created_at timestamptz not null default now());
create table public.positions(id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id), payer_id uuid not null references public.profiles(id), product_id uuid not null references public.products(id), name text not null, category text not null, image text not null, principal_cents bigint not null check(principal_cents>0), daily_bps integer not null check(daily_bps between 0 and 10000), duration_days integer not null check(duration_days between 1 and 3650), paid_periods integer not null default 0 check(paid_periods>=0), earned_cents bigint not null default 0, return_principal boolean not null default false, principal_returned boolean not null default false, status text not null default 'active' check(status in ('active','paused','completed','cancelled')), created_at timestamptz not null default now());
create table public.ledger(id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id), kind text not null, amount_cents bigint not null, available_delta bigint not null, reserved_delta bigint not null default 0, event_key text not null unique, description text not null, created_at timestamptz not null default now());
create table public.commissions(id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id), source_user_id uuid not null references public.profiles(id), level integer not null check(level between 1 and 3), amount_cents bigint not null, position_id uuid not null references public.positions(id), created_at timestamptz not null default now(), unique(user_id,source_user_id,level));
create table public.transfers(id uuid primary key default gen_random_uuid(), sender_id uuid not null references public.profiles(id), recipient_id uuid not null references public.profiles(id), amount_cents bigint not null check(amount_cents>0), created_at timestamptz not null default now());
create table public.deposits(id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id), amount_cents bigint not null check(amount_cents between 1 and 500000), provider_id text unique, status text not null default 'creating' check(status in ('creating','pending','completed','failed','refunded','review')), qr_code text, qr_code_image text, gateway_fee_cents bigint, last_error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.withdrawals(id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id), amount_cents bigint not null check(amount_cents between 3500 and 1000000), fee_cents bigint not null, payout_cents bigint not null check(payout_cents>0), pix_key text not null, pix_key_type text not null check(pix_key_type in ('cpf','cnpj','email','phone','evp')), recipient_document text not null, status text not null default 'requested' check(status in ('requested','approved','processing','completed','rejected','failed','review')), day_key date not null default (now() at time zone 'America/Sao_Paulo')::date, provider_id text unique, total_debit_cents bigint, last_error text, claimed_at timestamptz, approved_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_id,day_key));
create table public.webhook_inbox(delivery_id text primary key, event text not null, payload jsonb not null, status text not null default 'pending' check(status in ('pending','processed','review')), attempts integer not null default 0, last_error text, created_at timestamptz not null default now());
create table public.admin_audit(id bigint generated always as identity primary key, admin_id uuid references public.profiles(id), action text not null, details jsonb not null, created_at timestamptz not null default now());
create table public.app_requests(user_id uuid not null references public.profiles(id), request_id uuid not null, action text not null, result jsonb, primary key(user_id,request_id));
create index on public.positions(user_id,status);
create index on public.profiles(referred_by);
create index on public.ledger(user_id,created_at desc);
create index on public.withdrawals(status,created_at);
create index on public.deposits(status);
create unique index deposits_one_uncertain_per_user on public.deposits(user_id) where status in ('creating','review');

create or replace function public.create_user_profile() returns trigger language plpgsql security definer set search_path='' as $$
declare sponsor uuid;
begin
 select id into sponsor from public.profiles where referral_code=new.raw_user_meta_data->>'referral_code';
 insert into public.profiles(id,full_name,whatsapp,referred_by,contact_consent) values(new.id,trim(new.raw_user_meta_data->>'full_name'),regexp_replace(new.raw_user_meta_data->>'whatsapp','[^0-9]','','g'),sponsor,coalesce((new.raw_user_meta_data->>'contact_consent')::boolean,false));
 insert into public.wallets(user_id) values(new.id); return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.create_user_profile();
insert into public.wallets(user_id) select id from public.profiles on conflict do nothing;

create function public.actor_admin() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.profiles where id=auth.uid() and is_admin and not blocked) $$;
create function public.team_level(root uuid, leaf uuid) returns integer language sql stable security definer set search_path='' as $$
 with recursive t as (select id,1 lvl from public.profiles where referred_by=root union all select p.id,t.lvl+1 from public.profiles p join t on p.referred_by=t.id where t.lvl<3) select lvl from t where id=leaf limit 1
$$;
create function public.wallet_delta(uid uuid,kind text,av bigint,res bigint,ev text,descr text) returns void language plpgsql security definer set search_path='' as $$
begin
 insert into public.wallets(user_id) values(uid) on conflict do nothing;
 perform 1 from public.wallets where user_id=uid for update;
 if exists(select 1 from public.ledger where event_key=ev) then return; end if;
 update public.wallets set available_cents=available_cents+av,reserved_cents=reserved_cents+res where user_id=uid;
 insert into public.ledger(user_id,kind,amount_cents,available_delta,reserved_delta,event_key,description) values(uid,kind,case when av<>0 then av else res end,av,res,ev,descr);
end; $$;

create function public.app_snapshot(p_admin boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); result jsonb;
begin
 if uid is null then raise exception 'Autenticação necessária'; end if;
 if exists(select 1 from public.profiles where id=uid and blocked) then raise exception 'Conta suspensa. Contate o suporte.'; end if;
 select jsonb_build_object('profile',to_jsonb(p),'wallet',(select to_jsonb(w) from public.wallets w where user_id=uid),'settings',(select to_jsonb(s) from public.platform_settings s where id=1),'products',coalesce((select jsonb_agg(x order by x.price_cents) from public.products x where active or public.actor_admin()),'[]'::jsonb),'positions',coalesce((select jsonb_agg(x order by x.created_at desc) from public.positions x where user_id=uid),'[]'::jsonb),'ledger',coalesce((select jsonb_agg(x) from (select * from public.ledger where user_id=uid order by created_at desc limit 250)x),'[]'::jsonb),'deposits',coalesce((select jsonb_agg(x) from (select * from public.deposits where user_id=uid order by created_at desc limit 100)x),'[]'::jsonb),'withdrawals',coalesce((select jsonb_agg(x) from (select * from public.withdrawals where user_id=uid order by created_at desc limit 100)x),'[]'::jsonb),'commissions',coalesce((select jsonb_agg(x) from public.commissions x where user_id=uid),'[]'::jsonb),'team',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'full_name',t.full_name,'whatsapp',case when t.contact_consent then t.whatsapp else '' end,'level',public.team_level(uid,t.id),'active',exists(select 1 from public.positions a where a.user_id=t.id and status='active'),'products',(select coalesce(jsonb_agg(jsonb_build_object('name',a.name,'status',a.status,'principal_cents',a.principal_cents)),'[]'::jsonb) from public.positions a where a.user_id=t.id))) from public.profiles t where public.team_level(uid,t.id) is not null),'[]'::jsonb)) into result from public.profiles p where p.id=uid;
 if p_admin then
 if not public.actor_admin() then raise exception 'Acesso administrativo negado'; end if;
 result:=result||jsonb_build_object('admin',jsonb_build_object('users',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('wallet',to_jsonb(w),'email',(select u.email from auth.users u where u.id=p.id))) from public.profiles p join public.wallets w on w.user_id=p.id),'[]'::jsonb),'withdrawals',coalesce((select jsonb_agg(x) from (select * from public.withdrawals order by created_at desc limit 1000)x),'[]'::jsonb),'deposits',coalesce((select jsonb_agg(x) from (select * from public.deposits order by created_at desc limit 500)x),'[]'::jsonb),'positions',coalesce((select jsonb_agg(x) from public.positions x),'[]'::jsonb),'audit',coalesce((select jsonb_agg(x) from (select * from public.admin_audit order by id desc limit 100)x),'[]'::jsonb),'webhooks',coalesce((select jsonb_agg(jsonb_build_object('delivery_id',delivery_id,'event',event,'status',status,'last_error',last_error,'created_at',created_at)) from (select * from public.webhook_inbox order by created_at desc limit 100)x),'[]'::jsonb)));
 end if; return result;
end; $$;

create function public.app_action(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); rid uuid:=(p_data->>'request_id')::uuid; prev public.app_requests; cfg public.platform_settings; prod public.products; pos public.positions; wr public.withdrawals; target uuid; amt bigint; n integer; lvl integer; sponsor uuid; comm bigint; first_purchase boolean; out jsonb:='{}'; item jsonb; reason text;
begin
 if uid is null then raise exception 'Autenticação necessária'; end if;
 if rid is null then raise exception 'Identificador obrigatório'; end if;
 perform 1 from public.profiles where id=uid and not blocked for update;
 if not found then raise exception 'Conta indisponível'; end if;
 select * into prev from public.app_requests where user_id=uid and request_id=rid;
 if found then if prev.action<>p_action then raise exception 'Identificador reutilizado'; end if; return prev.result; end if;
 insert into public.app_requests(user_id,request_id,action) values(uid,rid,p_action);
 select * into cfg from public.platform_settings where id=1 for share;
 target:=coalesce(nullif(p_data->>'user_id','')::uuid,uid);
 if p_action in ('purchase','gift') then
 select * into prod from public.products where id=(p_data->>'product_id')::uuid and active;
 if not found then raise exception 'Produto indisponível'; end if;
 n:=coalesce((p_data->>'quantity')::integer,1); if n<1 or n>100 then raise exception 'Quantidade entre 1 e 100'; end if;
 if p_action='purchase' then target:=uid; elsif public.team_level(uid,target) is null then raise exception 'Presente apenas para afiliados da equipe'; end if;
 -- Lock all wallets in deterministic order before debit + commission credits.
 perform 1 from public.wallets where user_id=uid or user_id in (with recursive up as (select referred_by id,1 lvl from public.profiles where id=uid union all select p.referred_by,up.lvl+1 from public.profiles p join up on p.id=up.id where up.lvl<3) select id from up where id is not null) order by user_id for update;
 amt:=prod.price_cents*n;
 perform public.wallet_delta(uid,'purchase',-amt,0,'purchase:'||rid,'Compra: '||prod.name||case when p_action='gift' then ' (presente)' else '' end);
 first_purchase:=p_action='purchase' and (select first_purchase_at is null from public.profiles where id=uid);
 for i in 1..n loop
 insert into public.positions(user_id,payer_id,product_id,name,category,image,principal_cents,daily_bps,duration_days,return_principal) values(target,uid,prod.id,prod.name,prod.category,prod.image,prod.price_cents,prod.daily_bps,prod.duration_days,cfg.return_principal) returning * into pos;
 end loop;
 if first_purchase then
 update public.profiles set first_purchase_at=now() where id=uid;
 sponsor:=(select referred_by from public.profiles where id=uid);
 for lvl in 1..3 loop
 exit when sponsor is null;
 comm:=floor(prod.price_cents::numeric*cfg.commission_bps[lvl]/10000)::bigint;
 if comm>0 then insert into public.commissions(user_id,source_user_id,level,amount_cents,position_id) values(sponsor,uid,lvl,comm,pos.id); perform public.wallet_delta(sponsor,'commission',comm,0,'commission:'||uid||':'||lvl,'Comissão de primeira compra · nível '||lvl); end if;
 sponsor:=(select referred_by from public.profiles where id=sponsor);
 end loop; end if;
 out:=jsonb_build_object('position_id',pos.id);
 elsif p_action='transfer' then
 if public.team_level(uid,target) is null then raise exception 'Destinatário fora da equipe'; end if;
 amt:=(p_data->>'amount_cents')::bigint;
 if amt is null or amt<1 then raise exception 'Valor inválido'; end if;
 if amt+coalesce((select sum(amount_cents) from public.transfers where sender_id=uid and (created_at at time zone 'America/Sao_Paulo')::date=(now() at time zone 'America/Sao_Paulo')::date),0)>10000 then raise exception 'Limite de transferência: R$100 por dia'; end if;
 perform 1 from public.wallets where user_id in (uid,target) order by user_id for update;
 perform public.wallet_delta(uid,'transfer',-amt,0,'transfer-out:'||rid,'Doação para afiliado');
 perform public.wallet_delta(target,'transfer',amt,0,'transfer-in:'||rid,'Saldo recebido da equipe');
 insert into public.transfers(sender_id,recipient_id,amount_cents) values(uid,target,amt);
 elsif p_action='withdrawal' then
 if not cfg.withdrawals_enabled then raise exception 'Saques desativados no momento'; end if;
 if not exists(select 1 from public.positions where user_id=uid and status in ('active','completed')) then raise exception 'Adquira um produto antes de sacar'; end if;
 amt:=(p_data->>'amount_cents')::bigint; if amt is null or amt<3500 or amt>1000000 then raise exception 'Saque entre R$35 e R$10.000'; end if;
 if exists(select 1 from public.withdrawals where user_id=uid and day_key=(now() at time zone 'America/Sao_Paulo')::date) then raise exception 'Você já solicitou um saque hoje'; end if;
 if length(coalesce(p_data->>'pix_key',''))<3 or length(p_data->>'pix_key')>200 then raise exception 'Chave Pix inválida'; end if;
 if p_data->>'pix_key_type' not in ('cpf','cnpj','email','phone','evp') then raise exception 'Tipo de chave inválido'; end if;
 if p_data->>'recipient_document' !~ '^[0-9]{11}$|^[0-9]{14}$' then raise exception 'CPF/CNPJ do destinatário obrigatório'; end if;
 insert into public.withdrawals(user_id,amount_cents,fee_cents,payout_cents,pix_key,pix_key_type,recipient_document) values(uid,amt,floor(amt::numeric*500/10000),amt-floor(amt::numeric*500/10000),p_data->>'pix_key',p_data->>'pix_key_type',p_data->>'recipient_document') returning * into wr;
 perform public.wallet_delta(uid,'withdrawal_requested',-amt,amt,'withdrawal-request:'||wr.id,'Saque solicitado; saldo reservado');out:=to_jsonb(wr);
 elsif p_action='profile' then
 update public.profiles set full_name=trim(p_data->>'full_name'),whatsapp=regexp_replace(p_data->>'whatsapp','[^0-9]','','g'),contact_consent=coalesce((p_data->>'contact_consent')::boolean,false),avatar_url=case when coalesce(p_data->>'avatar_url','') ~ '^https://' then p_data->>'avatar_url' else '' end where id=uid;
 elsif left(p_action,6)='admin_' then
 if not public.actor_admin() then raise exception 'Acesso administrativo negado'; end if;
 reason:=coalesce(p_data->>'reason','');
 if p_action='admin_product' then
 if nullif(p_data->>'id','') is null then
 insert into public.products(name,category,description,image,price_cents,daily_bps,duration_days,active) values(p_data->>'name',p_data->>'category',coalesce(p_data->>'description',''),p_data->>'image',(p_data->>'price_cents')::bigint,(p_data->>'daily_bps')::integer,(p_data->>'duration_days')::integer,(p_data->>'active')::boolean) returning jsonb_build_object('id',id) into out;
 else update public.products set name=p_data->>'name',category=p_data->>'category',description=coalesce(p_data->>'description',''),image=p_data->>'image',price_cents=(p_data->>'price_cents')::bigint,daily_bps=(p_data->>'daily_bps')::integer,duration_days=(p_data->>'duration_days')::integer,active=(p_data->>'active')::boolean where id=(p_data->>'id')::uuid; end if;
 elsif p_action='admin_settings' then
 if coalesce(p_data->>'whatsapp_group','')<>'' and p_data->>'whatsapp_group' !~ '^https://chat\.whatsapp\.com/[A-Za-z0-9/?=&_-]+$' then raise exception 'Link do grupo inválido'; end if;
 update public.platform_settings set withdrawals_enabled=(p_data->>'withdrawals_enabled')::boolean,commission_bps=array[(p_data->>'level1_bps')::integer,(p_data->>'level2_bps')::integer,(p_data->>'level3_bps')::integer],whatsapp_group=coalesce(p_data->>'whatsapp_group',''),return_principal=(p_data->>'return_principal')::boolean where id=1;
 elsif p_action='admin_user' then
 if target=uid and (p_data->>'blocked')::boolean then raise exception 'Não bloqueie sua própria conta'; end if;
 update public.profiles set full_name=trim(p_data->>'full_name'),whatsapp=regexp_replace(p_data->>'whatsapp','[^0-9]','','g'),blocked=(p_data->>'blocked')::boolean where id=target;
 elsif p_action='admin_balance' then
 if char_length(reason)<5 then raise exception 'Informe o motivo do ajuste'; end if;
 amt:=(p_data->>'amount_cents')::bigint; if amt is null or amt<0 then raise exception 'Saldo inválido'; end if;
 perform 1 from public.wallets where user_id=target for update;
 perform public.wallet_delta(target,'admin_adjustment',amt-(select available_cents from public.wallets where user_id=target),0,'admin-balance:'||rid,reason);
 elsif p_action='admin_position' then
 if char_length(reason)<5 then raise exception 'Informe o motivo'; end if;
 if nullif(p_data->>'id','') is null then
 select * into prod from public.products where id=(p_data->>'product_id')::uuid;
 if not found then raise exception 'Produto inválido'; end if;
 insert into public.positions(user_id,payer_id,product_id,name,category,image,principal_cents,daily_bps,duration_days,return_principal) values(target,uid,prod.id,prod.name,prod.category,prod.image,prod.price_cents,prod.daily_bps,prod.duration_days,cfg.return_principal);
 else
 select * into pos from public.positions where id=(p_data->>'id')::uuid for update;
 if (p_data->>'duration_days')::integer<pos.paid_periods then raise exception 'Prazo inferior aos períodos pagos'; end if;
 update public.positions set status=p_data->>'status',daily_bps=(p_data->>'daily_bps')::integer,duration_days=(p_data->>'duration_days')::integer where id=pos.id;
 end if;
 elsif p_action='admin_retry_withdrawal' then
 if not cfg.withdrawals_enabled then raise exception 'Ative os saques antes de repetir'; end if;
 select * into wr from public.withdrawals where id=(p_data->>'id')::uuid for update;
 if wr.status<>'review' then raise exception 'Somente saques em análise podem ser repetidos'; end if;
 if char_length(reason)<5 then raise exception 'Informe o motivo'; end if;
 update public.withdrawals set status='approved',approved_by=uid,last_error=null where id=wr.id;
 elsif p_action='admin_retry_event' then
 update public.webhook_inbox set status='pending',attempts=0,last_error=null where delivery_id=p_data->>'delivery_id' and status='review';
 elsif p_action in ('admin_approve','admin_reject') then
 if p_action='admin_approve' and not cfg.withdrawals_enabled then raise exception 'Ative os saques antes de aprovar'; end if;
 for item in select value from jsonb_array_elements(p_data->'ids') loop
 select * into wr from public.withdrawals where id=(item#>>'{}')::uuid for update;
 if wr.status='requested' then
 if p_action='admin_approve' then update public.withdrawals set status='approved',approved_by=uid,updated_at=now() where id=wr.id;
 else perform public.wallet_delta(wr.user_id,'withdrawal_rejected',wr.amount_cents,-wr.amount_cents,'withdrawal-release:'||wr.id,'Saque rejeitado: '||reason);update public.withdrawals set status='rejected',last_error=reason,updated_at=now() where id=wr.id;end if;
 end if; end loop;
 else raise exception 'Ação administrativa desconhecida'; end if;
 insert into public.admin_audit(admin_id,action,details) values(uid,p_action,p_data-'pix_key'-'recipient_document');
 else raise exception 'Ação desconhecida'; end if;
 update public.app_requests set result=out where user_id=uid and request_id=rid;
 return out;
end; $$;

-- Locked financial primitives are service-role only.
create function public.settle_withdrawal(p_id uuid,p_status text,p_provider_id text default null,p_total_debit bigint default null,p_error text default null) returns void language plpgsql security definer set search_path='' as $$
declare w public.withdrawals;
begin
 select * into w from public.withdrawals where id=p_id for update;
 if not found then raise exception 'Saque não encontrado'; end if;
 if w.status in ('completed','failed','rejected') then return; end if;
 if w.provider_id is not null and p_provider_id is not null and w.provider_id<>p_provider_id then raise exception 'ID do provedor divergente'; end if;
 if p_status='completed' then
 if w.status not in ('processing','review','approved') then raise exception 'Saque não autorizado'; end if;
 if p_total_debit is null or p_total_debit<w.payout_cents then raise exception 'Conciliação exige total_debit'; end if;
 perform public.wallet_delta(w.user_id,'withdrawal_completed',0,-w.amount_cents,'withdrawal-settle:'||w.id,'Saque Pix concluído');
 elsif p_status='failed' then
 perform public.wallet_delta(w.user_id,'withdrawal_failed',w.amount_cents,-w.amount_cents,'withdrawal-release:'||w.id,'Saque recusado pelo provedor');
 elsif p_status<>'review' then raise exception 'Estado inválido'; end if;
 update public.withdrawals set status=p_status,provider_id=coalesce(p_provider_id,provider_id),total_debit_cents=coalesce(p_total_debit,total_debit_cents),last_error=p_error,updated_at=now() where id=w.id;
end; $$;
create function public.settle_deposit(p_id uuid,p_provider_id text,p_amount bigint,p_status text,p_fee bigint default 0) returns void language plpgsql security definer set search_path='' as $$
declare d public.deposits;
begin
 select * into d from public.deposits where id=p_id for update;
 if not found or d.amount_cents<>p_amount or d.provider_id<>p_provider_id then raise exception 'Cobrança divergente'; end if;
 if p_status='completed' and d.status in ('creating','pending','review') then
 perform public.wallet_delta(d.user_id,'deposit',d.amount_cents,0,'deposit:'||d.id,'Depósito Pix confirmado');update public.deposits set status='completed',gateway_fee_cents=p_fee,updated_at=now() where id=d.id;
 elsif p_status='refunded' and d.status='completed' then
 -- Insufficient balance raises and leaves the event in review for an audited correction.
 perform public.wallet_delta(d.user_id,'refund',-d.amount_cents,0,'refund:'||d.id,'Estorno de depósito Pix');update public.deposits set status='refunded',updated_at=now() where id=d.id;
 elsif p_status='failed' and d.status in ('creating','pending') then update public.deposits set status='failed',updated_at=now() where id=d.id;
 end if;
end; $$;
create function public.claim_withdrawals(p_limit integer default 20) returns setof public.withdrawals language plpgsql security definer set search_path='' as $$
begin
 if not (select withdrawals_enabled from public.platform_settings where id=1) then return; end if;
 return query update public.withdrawals set status='processing',claimed_at=now(),updated_at=now() where id in (select id from public.withdrawals where status='approved' or (status='processing' and claimed_at<now()-interval '10 minutes') order by created_at for update skip locked limit least(p_limit,50)) returning *;
end; $$;
create function public.process_yields() returns integer language plpgsql security definer set search_path='' as $$
declare p public.positions; due integer; period integer; amount bigint; count_paid integer:=0;
begin
 for p in select x.* from public.positions x join public.profiles u on u.id=x.user_id where x.status='active' and not u.blocked order by x.user_id,x.id for update of x skip locked loop
 due:=least(p.duration_days,floor(extract(epoch from (now()-p.created_at))/86400)::integer);
 if due>p.paid_periods then
 amount:=floor(p.principal_cents::numeric*p.daily_bps/10000)::bigint;
 for period in p.paid_periods+1..due loop
 perform public.wallet_delta(p.user_id,'yield',amount,0,'yield:'||p.id||':'||period,'Rendimento: '||p.name||' · dia '||period);count_paid:=count_paid+1;
 end loop;
 update public.positions set paid_periods=due,earned_cents=earned_cents+amount*(due-p.paid_periods) where id=p.id;
 end if;
 if due>=p.duration_days then
 if p.return_principal and not p.principal_returned then perform public.wallet_delta(p.user_id,'principal_return',p.principal_cents,0,'principal:'||p.id,'Devolução de principal: '||p.name); end if;
 update public.positions set status='completed',principal_returned=return_principal where id=p.id;
 end if;
 end loop;return count_paid;
end; $$;

-- Default privileges: no direct financial writes, no function callable by PUBLIC.
do $$ declare t text;begin
 foreach t in array array['profiles','platform_settings','wallets','products','positions','ledger','commissions','transfers','deposits','withdrawals','webhook_inbox','admin_audit','app_requests'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 end loop;
end $$;
-- RPC-only reads expose exactly the current user's projection.
revoke all on function public.create_user_profile(),public.actor_admin(),public.team_level(uuid,uuid),public.wallet_delta(uuid,text,bigint,bigint,text,text),public.app_snapshot(boolean),public.app_action(text,jsonb),public.settle_withdrawal(uuid,text,text,bigint,text),public.settle_deposit(uuid,text,bigint,text,bigint),public.claim_withdrawals(integer),public.process_yields() from public,anon,authenticated;
grant execute on function public.app_snapshot(boolean),public.app_action(text,jsonb) to authenticated;
grant execute on function public.settle_withdrawal(uuid,text,text,bigint,text),public.settle_deposit(uuid,text,bigint,text,bigint),public.claim_withdrawals(integer),public.process_yields() to service_role;
grant all on all tables in schema public to service_role;
grant usage,select on all sequences in schema public to service_role;

-- Migração: 202610060002_catalog.sql
insert into public.products(name,category,description,image,price_cents,daily_bps,duration_days,active) values
('Patinete urbano','production','Projeto de produção de patinetes elétricos. Imagem conceitual. Condições definidas no painel administrativo.','/assets/patinete-bateria-componentes.png',7000,0,30,false),
('Drone inteligente','production','Projeto de montagem de drones. Imagem conceitual.','/assets/drone-eletronica-carcaca-bateria.png',22000,0,30,false),
('Moto elétrica','production','Projeto de produção de motos elétricas. Imagem conceitual.','/assets/moto-estrutura-bateria-motor.png',64000,0,30,false),
('SUV elétrico','production','Projeto de produção de veículos elétricos. Imagem conceitual.','/assets/carro-carroceria-chassi-baterias.png',160000,0,30,false),
('Lote de patinetes','distribution','Projeto de distribuição de patinetes elétricos. Imagem conceitual.','/assets/lote-quatro-patinetes-eletricos.png',12000,0,30,false),
('Lote de drones','distribution','Projeto de distribuição de drones. Imagem conceitual.','/assets/lote-tres-drones-maleta-transporte.png',32000,0,30,false),
('Lote de motos','distribution','Projeto de distribuição de motos elétricas. Imagem conceitual.','/assets/lote-tres-motos-eletricas.png',93000,0,30,false),
('Lote de SUVs','distribution','Projeto de distribuição de veículos elétricos. Imagem conceitual.','/assets/lote-tres-carros-eletricos.png',250000,0,30,false);
-- Initial catalog is a draft: confirm real terms before activation.

-- Migração: 202610060003_investment_terms.sql
-- Revised launch terms. Purchases snapshot these settings; existing contracts
-- keep the conditions recorded when acquired.
alter table public.platform_settings alter column return_principal set default true;
update public.platform_settings set return_principal=true where id=1;
alter table public.positions alter column return_principal set default true;
alter table public.products alter column daily_bps set default 500;
alter table public.products alter column duration_days drop default;

-- A missing duration uses the category's initial term. An explicit admin value
-- always takes precedence, including terms shorter/longer than 10 or 15 days.
create function public.product_default_terms() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.duration_days is null then
  new.duration_days:=case when new.category='distribution' then 15 else 10 end;
 end if;
 if new.daily_bps is null then new.daily_bps:=500; end if;
 return new;
end; $$;
create trigger product_default_terms before insert on public.products
for each row execute function public.product_default_terms();
revoke all on function public.product_default_terms() from public,anon,authenticated;
grant execute on function public.product_default_terms() to service_role;

-- Update the original untouched draft catalog without resetting custom terms.
update public.products p
set daily_bps=v.daily_bps,duration_days=v.duration_days
from (values
 ('Patinete urbano','/assets/patinete-bateria-componentes.png',500,10),
 ('Drone inteligente','/assets/drone-eletronica-carcaca-bateria.png',600,10),
 ('Moto elétrica','/assets/moto-estrutura-bateria-motor.png',700,10),
 ('SUV elétrico','/assets/carro-carroceria-chassi-baterias.png',800,10),
 ('Lote de patinetes','/assets/lote-quatro-patinetes-eletricos.png',500,15),
 ('Lote de drones','/assets/lote-tres-drones-maleta-transporte.png',600,15),
 ('Lote de motos','/assets/lote-tres-motos-eletricas.png',700,15),
 ('Lote de SUVs','/assets/lote-tres-carros-eletricos.png',800,15)
) as v(name,image,daily_bps,duration_days)
where p.name=v.name and p.image=v.image and p.daily_bps=0 and p.duration_days=30
and p.category=case when v.duration_days=15 then 'distribution' else 'production' end;

-- Migração: 202610060004_admin_and_webhook_queue.sql
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

-- Migração: 202610070001_launch_rules.sql
alter table public.platform_settings alter column commission_bps set default '{1500,500,200}';
insert into public.admin_audit(admin_id,action,details)
select null,'launch_rules',jsonb_build_object(
 'migration','202610070001_launch_rules',
 'previous_commission_bps',commission_bps,'commission_bps',array[1500,500,200],
 'commission_basis','one_unit_first_purchase',
 'withdrawal_min_cents',3000,'withdrawal_max_cents',1000000,
 'deposit_min_cents',3500,'deposit_max_cents',500000)
from public.platform_settings where id=1;
update public.platform_settings set commission_bps='{1500,500,200}' where id=1;

alter table public.withdrawals drop constraint withdrawals_amount_cents_check;
alter table public.withdrawals add constraint withdrawals_amount_cents_check
 check(amount_cents between 3000 and 1000000);

create function public.deposit_launch_amount() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.amount_cents is null or new.amount_cents<3500 or new.amount_cents>500000 then
  raise exception 'Depósito entre R$35 e R$5.000' using errcode='23514';
 end if;
 return new;
end; $$;
create trigger deposit_launch_amount before insert or update of amount_cents on public.deposits
for each row execute function public.deposit_launch_amount();
revoke all on function public.deposit_launch_amount() from public,anon,authenticated;
grant execute on function public.deposit_launch_amount() to service_role;

create or replace function public.app_action_internal(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); rid uuid:=(p_data->>'request_id')::uuid; prev public.app_requests; cfg public.platform_settings; prod public.products; pos public.positions; wr public.withdrawals; target uuid; amt bigint; n integer; lvl integer; sponsor uuid; comm bigint; first_purchase boolean; out jsonb:='{}'; item jsonb; reason text;
begin
 if uid is null then raise exception 'Autenticação necessária'; end if;
 if rid is null then raise exception 'Identificador obrigatório'; end if;
 perform 1 from public.profiles where id=uid and not blocked for update;
 if not found then raise exception 'Conta indisponível'; end if;
 select * into prev from public.app_requests where user_id=uid and request_id=rid;
 if found then if prev.action<>p_action then raise exception 'Identificador reutilizado'; end if; return prev.result; end if;
 insert into public.app_requests(user_id,request_id,action) values(uid,rid,p_action);
 select * into cfg from public.platform_settings where id=1 for share;
 target:=coalesce(nullif(p_data->>'user_id','')::uuid,uid);
 if p_action in ('purchase','gift') then
 select * into prod from public.products where id=(p_data->>'product_id')::uuid and active;
 if not found then raise exception 'Produto indisponível'; end if;
 n:=coalesce((p_data->>'quantity')::integer,1); if n<1 or n>100 then raise exception 'Quantidade entre 1 e 100'; end if;
 if p_action='purchase' then target:=uid; elsif public.team_level(uid,target) is null then raise exception 'Presente apenas para afiliados da equipe'; end if;
 -- Lock all wallets in deterministic order before debit + commission credits.
 perform 1 from public.wallets where user_id=uid or user_id in (with recursive up as (select referred_by id,1 lvl from public.profiles where id=uid union all select p.referred_by,up.lvl+1 from public.profiles p join up on p.id=up.id where up.lvl<3) select id from up where id is not null) order by user_id for update;
 amt:=prod.price_cents*n;
 perform public.wallet_delta(uid,'purchase',-amt,0,'purchase:'||rid,'Compra: '||prod.name||case when p_action='gift' then ' (presente)' else '' end);
 first_purchase:=p_action='purchase' and (select first_purchase_at is null from public.profiles where id=uid);
 for i in 1..n loop
 insert into public.positions(user_id,payer_id,product_id,name,category,image,principal_cents,daily_bps,duration_days,return_principal) values(target,uid,prod.id,prod.name,prod.category,prod.image,prod.price_cents,prod.daily_bps,prod.duration_days,cfg.return_principal) returning * into pos;
 end loop;
 if first_purchase then
 update public.profiles set first_purchase_at=now() where id=uid;
 sponsor:=(select referred_by from public.profiles where id=uid);
 for lvl in 1..3 loop
 exit when sponsor is null;
 comm:=floor(prod.price_cents::numeric*cfg.commission_bps[lvl]/10000)::bigint;
 if comm>0 then insert into public.commissions(user_id,source_user_id,level,amount_cents,position_id) values(sponsor,uid,lvl,comm,pos.id); perform public.wallet_delta(sponsor,'commission',comm,0,'commission:'||uid||':'||lvl,'Comissão de primeira compra · nível '||lvl); end if;
 sponsor:=(select referred_by from public.profiles where id=sponsor);
 end loop; end if;
 out:=jsonb_build_object('position_id',pos.id);
 elsif p_action='transfer' then
 if public.team_level(uid,target) is null then raise exception 'Destinatário fora da equipe'; end if;
 amt:=(p_data->>'amount_cents')::bigint;
 if amt is null or amt<1 then raise exception 'Valor inválido'; end if;
 if amt+coalesce((select sum(amount_cents) from public.transfers where sender_id=uid and (created_at at time zone 'America/Sao_Paulo')::date=(now() at time zone 'America/Sao_Paulo')::date),0)>10000 then raise exception 'Limite de transferência: R$100 por dia'; end if;
 perform 1 from public.wallets where user_id in (uid,target) order by user_id for update;
 perform public.wallet_delta(uid,'transfer',-amt,0,'transfer-out:'||rid,'Doação para afiliado');
 perform public.wallet_delta(target,'transfer',amt,0,'transfer-in:'||rid,'Saldo recebido da equipe');
 insert into public.transfers(sender_id,recipient_id,amount_cents) values(uid,target,amt);
 elsif p_action='withdrawal' then
 if not cfg.withdrawals_enabled then raise exception 'Saques desativados no momento'; end if;
 if not exists(select 1 from public.positions where user_id=uid and status in ('active','completed')) then raise exception 'Adquira um produto antes de sacar'; end if;
 amt:=(p_data->>'amount_cents')::bigint; if amt is null or amt<3000 or amt>1000000 then raise exception 'Saque entre R$30 e R$10.000'; end if;
 if exists(select 1 from public.withdrawals where user_id=uid and day_key=(now() at time zone 'America/Sao_Paulo')::date) then raise exception 'Você já solicitou um saque hoje'; end if;
 if length(coalesce(p_data->>'pix_key',''))<3 or length(p_data->>'pix_key')>200 then raise exception 'Chave Pix inválida'; end if;
 if p_data->>'pix_key_type' not in ('cpf','cnpj','email','phone','evp') then raise exception 'Tipo de chave inválido'; end if;
 if p_data->>'recipient_document' !~ '^[0-9]{11}$|^[0-9]{14}$' then raise exception 'CPF/CNPJ do destinatário obrigatório'; end if;
 insert into public.withdrawals(user_id,amount_cents,fee_cents,payout_cents,pix_key,pix_key_type,recipient_document) values(uid,amt,floor(amt::numeric*500/10000),amt-floor(amt::numeric*500/10000),p_data->>'pix_key',p_data->>'pix_key_type',p_data->>'recipient_document') returning * into wr;
 perform public.wallet_delta(uid,'withdrawal_requested',-amt,amt,'withdrawal-request:'||wr.id,'Saque solicitado; saldo reservado');out:=to_jsonb(wr);
 elsif p_action='profile' then
 update public.profiles set full_name=trim(p_data->>'full_name'),whatsapp=regexp_replace(p_data->>'whatsapp','[^0-9]','','g'),contact_consent=coalesce((p_data->>'contact_consent')::boolean,false),avatar_url=case when coalesce(p_data->>'avatar_url','') ~ '^https://' then p_data->>'avatar_url' else '' end where id=uid;
 elsif left(p_action,6)='admin_' then
 if not public.actor_admin() then raise exception 'Acesso administrativo negado'; end if;
 reason:=coalesce(p_data->>'reason','');
 if p_action='admin_product' then
 if nullif(p_data->>'id','') is null then
 insert into public.products(name,category,description,image,price_cents,daily_bps,duration_days,active) values(p_data->>'name',p_data->>'category',coalesce(p_data->>'description',''),p_data->>'image',(p_data->>'price_cents')::bigint,(p_data->>'daily_bps')::integer,(p_data->>'duration_days')::integer,(p_data->>'active')::boolean) returning jsonb_build_object('id',id) into out;
 else update public.products set name=p_data->>'name',category=p_data->>'category',description=coalesce(p_data->>'description',''),image=p_data->>'image',price_cents=(p_data->>'price_cents')::bigint,daily_bps=(p_data->>'daily_bps')::integer,duration_days=(p_data->>'duration_days')::integer,active=(p_data->>'active')::boolean where id=(p_data->>'id')::uuid; end if;
 elsif p_action='admin_settings' then
 if coalesce(p_data->>'whatsapp_group','')<>'' and p_data->>'whatsapp_group' !~ '^https://chat\.whatsapp\.com/[A-Za-z0-9/?=&_-]+$' then raise exception 'Link do grupo inválido'; end if;
 update public.platform_settings set withdrawals_enabled=(p_data->>'withdrawals_enabled')::boolean,commission_bps=array[(p_data->>'level1_bps')::integer,(p_data->>'level2_bps')::integer,(p_data->>'level3_bps')::integer],whatsapp_group=coalesce(p_data->>'whatsapp_group',''),return_principal=(p_data->>'return_principal')::boolean where id=1;
 elsif p_action='admin_user' then
 if target=uid and (p_data->>'blocked')::boolean then raise exception 'Não bloqueie sua própria conta'; end if;
 update public.profiles set full_name=trim(p_data->>'full_name'),whatsapp=regexp_replace(p_data->>'whatsapp','[^0-9]','','g'),blocked=(p_data->>'blocked')::boolean where id=target;
 elsif p_action='admin_balance' then
 if char_length(reason)<5 then raise exception 'Informe o motivo do ajuste'; end if;
 amt:=(p_data->>'amount_cents')::bigint; if amt is null or amt<0 then raise exception 'Saldo inválido'; end if;
 perform 1 from public.wallets where user_id=target for update;
 perform public.wallet_delta(target,'admin_adjustment',amt-(select available_cents from public.wallets where user_id=target),0,'admin-balance:'||rid,reason);
 elsif p_action='admin_position' then
 if char_length(reason)<5 then raise exception 'Informe o motivo'; end if;
 if nullif(p_data->>'id','') is null then
 select * into prod from public.products where id=(p_data->>'product_id')::uuid;
 if not found then raise exception 'Produto inválido'; end if;
 insert into public.positions(user_id,payer_id,product_id,name,category,image,principal_cents,daily_bps,duration_days,return_principal) values(target,uid,prod.id,prod.name,prod.category,prod.image,prod.price_cents,prod.daily_bps,prod.duration_days,cfg.return_principal);
 else
 select * into pos from public.positions where id=(p_data->>'id')::uuid for update;
 if (p_data->>'duration_days')::integer<pos.paid_periods then raise exception 'Prazo inferior aos períodos pagos'; end if;
 update public.positions set status=p_data->>'status',daily_bps=(p_data->>'daily_bps')::integer,duration_days=(p_data->>'duration_days')::integer where id=pos.id;
 end if;
 elsif p_action='admin_retry_withdrawal' then
 if not cfg.withdrawals_enabled then raise exception 'Ative os saques antes de repetir'; end if;
 select * into wr from public.withdrawals where id=(p_data->>'id')::uuid for update;
 if wr.status<>'review' then raise exception 'Somente saques em análise podem ser repetidos'; end if;
 if char_length(reason)<5 then raise exception 'Informe o motivo'; end if;
 update public.withdrawals set status='approved',approved_by=uid,last_error=null where id=wr.id;
 elsif p_action='admin_retry_event' then
 update public.webhook_inbox set status='pending',attempts=0,last_error=null where delivery_id=p_data->>'delivery_id' and status='review';
 elsif p_action in ('admin_approve','admin_reject') then
 if p_action='admin_approve' and not cfg.withdrawals_enabled then raise exception 'Ative os saques antes de aprovar'; end if;
 for item in select value from jsonb_array_elements(p_data->'ids') loop
 select * into wr from public.withdrawals where id=(item#>>'{}')::uuid for update;
 if wr.status='requested' then
 if p_action='admin_approve' then update public.withdrawals set status='approved',approved_by=uid,updated_at=now() where id=wr.id;
 else perform public.wallet_delta(wr.user_id,'withdrawal_rejected',wr.amount_cents,-wr.amount_cents,'withdrawal-release:'||wr.id,'Saque rejeitado: '||reason);update public.withdrawals set status='rejected',last_error=reason,updated_at=now() where id=wr.id;end if;
 end if; end loop;
 else raise exception 'Ação administrativa desconhecida'; end if;
 insert into public.admin_audit(admin_id,action,details) values(uid,p_action,p_data-'pix_key'-'recipient_document');
 else raise exception 'Ação desconhecida'; end if;
 update public.app_requests set result=out where user_id=uid and request_id=rid;
 return out;
end; $$;
revoke all on function public.app_action_internal(text,jsonb) from public,anon,authenticated,service_role;

-- Migração: 202610070002_admin_batch_and_transfer_history.sql
create or replace function public.app_action_internal(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); rid uuid:=(p_data->>'request_id')::uuid; prev public.app_requests; cfg public.platform_settings; prod public.products; pos public.positions; wr public.withdrawals; target uuid; amt bigint; n integer; lvl integer; sponsor uuid; comm bigint; first_purchase boolean; out jsonb:='{}'; item jsonb; reason text;
begin
 if uid is null then raise exception 'Autenticação necessária'; end if;
 if rid is null then raise exception 'Identificador obrigatório'; end if;
 perform 1 from public.profiles where id=uid and not blocked for update;
 if not found then raise exception 'Conta indisponível'; end if;
 select * into prev from public.app_requests where user_id=uid and request_id=rid;
 if found then if prev.action<>p_action then raise exception 'Identificador reutilizado'; end if; return prev.result; end if;
 insert into public.app_requests(user_id,request_id,action) values(uid,rid,p_action);
 select * into cfg from public.platform_settings where id=1 for share;
 target:=coalesce(nullif(p_data->>'user_id','')::uuid,uid);
 if p_action in ('purchase','gift') then
 select * into prod from public.products where id=(p_data->>'product_id')::uuid and active;
 if not found then raise exception 'Produto indisponível'; end if;
 n:=coalesce((p_data->>'quantity')::integer,1); if n<1 or n>100 then raise exception 'Quantidade entre 1 e 100'; end if;
 if p_action='purchase' then target:=uid; elsif public.team_level(uid,target) is null then raise exception 'Presente apenas para afiliados da equipe'; end if;
 -- Lock all wallets in deterministic order before debit + commission credits.
 perform 1 from public.wallets where user_id=uid or user_id in (with recursive up as (select referred_by id,1 lvl from public.profiles where id=uid union all select p.referred_by,up.lvl+1 from public.profiles p join up on p.id=up.id where up.lvl<3) select id from up where id is not null) order by user_id for update;
 amt:=prod.price_cents*n;
 perform public.wallet_delta(uid,'purchase',-amt,0,'purchase:'||rid,'Compra: '||prod.name||case when p_action='gift' then ' (presente)' else '' end);
 first_purchase:=p_action='purchase' and (select first_purchase_at is null from public.profiles where id=uid);
 for i in 1..n loop
 insert into public.positions(user_id,payer_id,product_id,name,category,image,principal_cents,daily_bps,duration_days,return_principal) values(target,uid,prod.id,prod.name,prod.category,prod.image,prod.price_cents,prod.daily_bps,prod.duration_days,cfg.return_principal) returning * into pos;
 end loop;
 if first_purchase then
 update public.profiles set first_purchase_at=now() where id=uid;
 sponsor:=(select referred_by from public.profiles where id=uid);
 for lvl in 1..3 loop
 exit when sponsor is null;
 comm:=floor(prod.price_cents::numeric*cfg.commission_bps[lvl]/10000)::bigint;
 if comm>0 then insert into public.commissions(user_id,source_user_id,level,amount_cents,position_id) values(sponsor,uid,lvl,comm,pos.id); perform public.wallet_delta(sponsor,'commission',comm,0,'commission:'||uid||':'||lvl,'Comissão de primeira compra · nível '||lvl); end if;
 sponsor:=(select referred_by from public.profiles where id=sponsor);
 end loop; end if;
 out:=jsonb_build_object('position_id',pos.id);
 elsif p_action='transfer' then
 if public.team_level(uid,target) is null then raise exception 'Destinatário fora da equipe'; end if;
 amt:=(p_data->>'amount_cents')::bigint;
 if amt is null or amt<1 then raise exception 'Valor inválido'; end if;
 if amt+coalesce((select sum(amount_cents) from public.transfers where sender_id=uid and (created_at at time zone 'America/Sao_Paulo')::date=(now() at time zone 'America/Sao_Paulo')::date),0)>10000 then raise exception 'Limite de transferência: R$100 por dia'; end if;
 perform 1 from public.wallets where user_id in (uid,target) order by user_id for update;
 perform public.wallet_delta(uid,'transfer',-amt,0,'transfer-out:'||rid,'Doação para afiliado');
 perform public.wallet_delta(target,'transfer',amt,0,'transfer-in:'||rid,'Saldo recebido da equipe');
 insert into public.transfers(sender_id,recipient_id,amount_cents) values(uid,target,amt);
 elsif p_action='withdrawal' then
 if not cfg.withdrawals_enabled then raise exception 'Saques desativados no momento'; end if;
 if not exists(select 1 from public.positions where user_id=uid and status in ('active','completed')) then raise exception 'Adquira um produto antes de sacar'; end if;
 amt:=(p_data->>'amount_cents')::bigint; if amt is null or amt<3000 or amt>1000000 then raise exception 'Saque entre R$30 e R$10.000'; end if;
 if exists(select 1 from public.withdrawals where user_id=uid and day_key=(now() at time zone 'America/Sao_Paulo')::date) then raise exception 'Você já solicitou um saque hoje'; end if;
 if length(coalesce(p_data->>'pix_key',''))<3 or length(p_data->>'pix_key')>200 then raise exception 'Chave Pix inválida'; end if;
 if p_data->>'pix_key_type' not in ('cpf','cnpj','email','phone','evp') then raise exception 'Tipo de chave inválido'; end if;
 if p_data->>'recipient_document' !~ '^[0-9]{11}$|^[0-9]{14}$' then raise exception 'CPF/CNPJ do destinatário obrigatório'; end if;
 insert into public.withdrawals(user_id,amount_cents,fee_cents,payout_cents,pix_key,pix_key_type,recipient_document) values(uid,amt,floor(amt::numeric*500/10000),amt-floor(amt::numeric*500/10000),p_data->>'pix_key',p_data->>'pix_key_type',p_data->>'recipient_document') returning * into wr;
 perform public.wallet_delta(uid,'withdrawal_requested',-amt,amt,'withdrawal-request:'||wr.id,'Saque solicitado; saldo reservado');out:=to_jsonb(wr);
 elsif p_action='profile' then
 update public.profiles set full_name=trim(p_data->>'full_name'),whatsapp=regexp_replace(p_data->>'whatsapp','[^0-9]','','g'),contact_consent=coalesce((p_data->>'contact_consent')::boolean,false),avatar_url=case when coalesce(p_data->>'avatar_url','') ~ '^https://' then p_data->>'avatar_url' else '' end where id=uid;
 elsif left(p_action,6)='admin_' then
 if not public.actor_admin() then raise exception 'Acesso administrativo negado'; end if;
 reason:=coalesce(p_data->>'reason','');
 if p_action='admin_product' then
 if nullif(p_data->>'id','') is null then
 insert into public.products(name,category,description,image,price_cents,daily_bps,duration_days,active) values(p_data->>'name',p_data->>'category',coalesce(p_data->>'description',''),p_data->>'image',(p_data->>'price_cents')::bigint,(p_data->>'daily_bps')::integer,(p_data->>'duration_days')::integer,(p_data->>'active')::boolean) returning jsonb_build_object('id',id) into out;
 else update public.products set name=p_data->>'name',category=p_data->>'category',description=coalesce(p_data->>'description',''),image=p_data->>'image',price_cents=(p_data->>'price_cents')::bigint,daily_bps=(p_data->>'daily_bps')::integer,duration_days=(p_data->>'duration_days')::integer,active=(p_data->>'active')::boolean where id=(p_data->>'id')::uuid; end if;
 elsif p_action='admin_settings' then
 if coalesce(p_data->>'whatsapp_group','')<>'' and p_data->>'whatsapp_group' !~ '^https://chat\.whatsapp\.com/[A-Za-z0-9/?=&_-]+$' then raise exception 'Link do grupo inválido'; end if;
 update public.platform_settings set withdrawals_enabled=(p_data->>'withdrawals_enabled')::boolean,commission_bps=array[(p_data->>'level1_bps')::integer,(p_data->>'level2_bps')::integer,(p_data->>'level3_bps')::integer],whatsapp_group=coalesce(p_data->>'whatsapp_group',''),return_principal=(p_data->>'return_principal')::boolean where id=1;
 elsif p_action='admin_user' then
 if target=uid and (p_data->>'blocked')::boolean then raise exception 'Não bloqueie sua própria conta'; end if;
 update public.profiles set full_name=trim(p_data->>'full_name'),whatsapp=regexp_replace(p_data->>'whatsapp','[^0-9]','','g'),blocked=(p_data->>'blocked')::boolean where id=target;
 elsif p_action='admin_balance' then
 if char_length(reason)<5 then raise exception 'Informe o motivo do ajuste'; end if;
 amt:=(p_data->>'amount_cents')::bigint; if amt is null or amt<0 then raise exception 'Saldo inválido'; end if;
 perform 1 from public.wallets where user_id=target for update;
 perform public.wallet_delta(target,'admin_adjustment',amt-(select available_cents from public.wallets where user_id=target),0,'admin-balance:'||rid,reason);
 elsif p_action='admin_position' then
 if char_length(reason)<5 then raise exception 'Informe o motivo'; end if;
 if nullif(p_data->>'id','') is null then
 select * into prod from public.products where id=(p_data->>'product_id')::uuid;
 if not found then raise exception 'Produto inválido'; end if;
 insert into public.positions(user_id,payer_id,product_id,name,category,image,principal_cents,daily_bps,duration_days,return_principal) values(target,uid,prod.id,prod.name,prod.category,prod.image,prod.price_cents,prod.daily_bps,prod.duration_days,cfg.return_principal);
 else
 select * into pos from public.positions where id=(p_data->>'id')::uuid for update;
 if (p_data->>'duration_days')::integer<pos.paid_periods then raise exception 'Prazo inferior aos períodos pagos'; end if;
 update public.positions set status=p_data->>'status',daily_bps=(p_data->>'daily_bps')::integer,duration_days=(p_data->>'duration_days')::integer where id=pos.id;
 end if;
 elsif p_action='admin_retry_withdrawal' then
 if not cfg.withdrawals_enabled then raise exception 'Ative os saques antes de repetir'; end if;
 select * into wr from public.withdrawals where id=(p_data->>'id')::uuid for update;
 if wr.status<>'review' then raise exception 'Somente saques em análise podem ser repetidos'; end if;
 if char_length(reason)<5 then raise exception 'Informe o motivo'; end if;
 update public.withdrawals set status='approved',approved_by=uid,last_error=null where id=wr.id;
 elsif p_action='admin_retry_event' then
 update public.webhook_inbox set status='pending',attempts=0,last_error=null where delivery_id=p_data->>'delivery_id' and status='review';
 elsif p_action='admin_approve_all' then
 if not cfg.withdrawals_enabled then raise exception 'Ative os saques antes de aprovar'; end if;
 update public.withdrawals set status='approved',approved_by=uid,updated_at=now() where status='requested';
 get diagnostics n=row_count;p_data:=p_data||jsonb_build_object('approved',n);out:=jsonb_build_object('approved',n);
 elsif p_action in ('admin_approve','admin_reject') then
 if p_action='admin_approve' and not cfg.withdrawals_enabled then raise exception 'Ative os saques antes de aprovar'; end if;
 for item in select value from jsonb_array_elements(p_data->'ids') loop
 select * into wr from public.withdrawals where id=(item#>>'{}')::uuid for update;
 if wr.status='requested' then
 if p_action='admin_approve' then update public.withdrawals set status='approved',approved_by=uid,updated_at=now() where id=wr.id;
 else perform public.wallet_delta(wr.user_id,'withdrawal_rejected',wr.amount_cents,-wr.amount_cents,'withdrawal-release:'||wr.id,'Saque rejeitado: '||reason);update public.withdrawals set status='rejected',last_error=reason,updated_at=now() where id=wr.id;end if;
 end if; end loop;
 else raise exception 'Ação administrativa desconhecida'; end if;
 insert into public.admin_audit(admin_id,action,details) values(uid,p_action,p_data-'pix_key'-'recipient_document');
 else raise exception 'Ação desconhecida'; end if;
 update public.app_requests set result=out where user_id=uid and request_id=rid;
 return out;
end; $$;
revoke all on function public.app_action_internal(text,jsonb) from public,anon,authenticated,service_role;

create or replace function public.app_snapshot(p_admin boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); result jsonb;
begin
 if uid is null then raise exception 'Autenticação necessária'; end if;
 if exists(select 1 from public.profiles where id=uid and blocked) then raise exception 'Conta suspensa. Contate o suporte.'; end if;
 select jsonb_build_object('profile',to_jsonb(p),'wallet',(select to_jsonb(w) from public.wallets w where user_id=uid),'settings',(select to_jsonb(s) from public.platform_settings s where id=1),'products',coalesce((select jsonb_agg(x order by x.price_cents) from public.products x where active or public.actor_admin()),'[]'::jsonb),'positions',coalesce((select jsonb_agg(x order by x.created_at desc) from public.positions x where user_id=uid),'[]'::jsonb),'ledger',coalesce((select jsonb_agg(x) from (select * from public.ledger where user_id=uid order by created_at desc limit 250)x),'[]'::jsonb),'deposits',coalesce((select jsonb_agg(x) from (select * from public.deposits where user_id=uid order by created_at desc limit 100)x),'[]'::jsonb),'withdrawals',coalesce((select jsonb_agg(x) from (select * from public.withdrawals where user_id=uid order by created_at desc limit 100)x),'[]'::jsonb),'transfers',coalesce((select jsonb_agg(x) from (select case when t.sender_id=uid then 'sent' else 'received' end direction,c.full_name counterparty,t.amount_cents,t.created_at from public.transfers t join public.profiles c on c.id=case when t.sender_id=uid then t.recipient_id else t.sender_id end where t.sender_id=uid or t.recipient_id=uid order by t.created_at desc limit 100)x),'[]'::jsonb),'commissions',coalesce((select jsonb_agg(x) from public.commissions x where user_id=uid),'[]'::jsonb),'team',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'full_name',t.full_name,'whatsapp',case when t.contact_consent then t.whatsapp else '' end,'level',public.team_level(uid,t.id),'active',exists(select 1 from public.positions a where a.user_id=t.id and status='active'),'products',(select coalesce(jsonb_agg(jsonb_build_object('name',a.name,'status',a.status,'principal_cents',a.principal_cents)),'[]'::jsonb) from public.positions a where a.user_id=t.id))) from public.profiles t where public.team_level(uid,t.id) is not null),'[]'::jsonb)) into result from public.profiles p where p.id=uid;
 if p_admin then
 if not public.actor_admin() then raise exception 'Acesso administrativo negado'; end if;
 result:=result||jsonb_build_object('admin',jsonb_build_object('users',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('wallet',to_jsonb(w),'email',(select u.email from auth.users u where u.id=p.id))) from public.profiles p join public.wallets w on w.user_id=p.id),'[]'::jsonb),'withdrawals',coalesce((select jsonb_agg(x) from (select * from public.withdrawals order by created_at desc limit 1000)x),'[]'::jsonb),'deposits',coalesce((select jsonb_agg(x) from (select * from public.deposits order by created_at desc limit 500)x),'[]'::jsonb),'positions',coalesce((select jsonb_agg(x) from public.positions x),'[]'::jsonb),'audit',coalesce((select jsonb_agg(x) from (select * from public.admin_audit order by id desc limit 100)x),'[]'::jsonb),'webhooks',coalesce((select jsonb_agg(jsonb_build_object('delivery_id',delivery_id,'event',event,'status',status,'last_error',last_error,'created_at',created_at)) from (select * from public.webhook_inbox order by created_at desc limit 100)x),'[]'::jsonb)));
 end if; return result;
end; $$;
revoke all on function public.app_snapshot(boolean) from public,anon,authenticated;
grant execute on function public.app_snapshot(boolean) to authenticated;

-- Migração: 202610070003_referral_lookup.sql
-- Consulta pública de código de indicação para o cadastro.
-- Revela apenas se o código existe; não expõe nome, contato ou vínculo do indicador.
create or replace function public.referral_lookup(p_code text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.profiles
    where referral_code=p_code and length(p_code) between 6 and 64
  )
$$;

revoke all on function public.referral_lookup(text) from public,anon,authenticated;
grant execute on function public.referral_lookup(text) to anon,authenticated;

-- Migração: 202610070004_auto_approve.sql
-- Aprovação automática de saques: quando ativa, a solicitação nasce 'approved'
-- e o worker a envia na próxima execução do cron (Pix quase instantâneo).
alter table public.platform_settings add column if not exists auto_approve_withdrawals boolean not null default false;

create or replace function public.app_action_internal(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); rid uuid:=(p_data->>'request_id')::uuid; prev public.app_requests; cfg public.platform_settings; prod public.products; pos public.positions; wr public.withdrawals; target uuid; amt bigint; n integer; lvl integer; sponsor uuid; comm bigint; first_purchase boolean; out jsonb:='{}'; item jsonb; reason text;
begin
 if uid is null then raise exception 'Autenticação necessária'; end if;
 if rid is null then raise exception 'Identificador obrigatório'; end if;
 perform 1 from public.profiles where id=uid and not blocked for update;
 if not found then raise exception 'Conta indisponível'; end if;
 select * into prev from public.app_requests where user_id=uid and request_id=rid;
 if found then if prev.action<>p_action then raise exception 'Identificador reutilizado'; end if; return prev.result; end if;
 insert into public.app_requests(user_id,request_id,action) values(uid,rid,p_action);
 select * into cfg from public.platform_settings where id=1 for share;
 target:=coalesce(nullif(p_data->>'user_id','')::uuid,uid);
 if p_action in ('purchase','gift') then
 select * into prod from public.products where id=(p_data->>'product_id')::uuid and active;
 if not found then raise exception 'Produto indisponível'; end if;
 n:=coalesce((p_data->>'quantity')::integer,1); if n<1 or n>100 then raise exception 'Quantidade entre 1 e 100'; end if;
 if p_action='purchase' then target:=uid; elsif public.team_level(uid,target) is null then raise exception 'Presente apenas para afiliados da equipe'; end if;
 -- Lock all wallets in deterministic order before debit + commission credits.
 perform 1 from public.wallets where user_id=uid or user_id in (with recursive up as (select referred_by id,1 lvl from public.profiles where id=uid union all select p.referred_by,up.lvl+1 from public.profiles p join up on p.id=up.id where up.lvl<3) select id from up where id is not null) order by user_id for update;
 amt:=prod.price_cents*n;
 perform public.wallet_delta(uid,'purchase',-amt,0,'purchase:'||rid,'Compra: '||prod.name||case when p_action='gift' then ' (presente)' else '' end);
 first_purchase:=p_action='purchase' and (select first_purchase_at is null from public.profiles where id=uid);
 for i in 1..n loop
 insert into public.positions(user_id,payer_id,product_id,name,category,image,principal_cents,daily_bps,duration_days,return_principal) values(target,uid,prod.id,prod.name,prod.category,prod.image,prod.price_cents,prod.daily_bps,prod.duration_days,cfg.return_principal) returning * into pos;
 end loop;
 if first_purchase then
 update public.profiles set first_purchase_at=now() where id=uid;
 sponsor:=(select referred_by from public.profiles where id=uid);
 for lvl in 1..3 loop
 exit when sponsor is null;
 comm:=floor(prod.price_cents::numeric*cfg.commission_bps[lvl]/10000)::bigint;
 if comm>0 then insert into public.commissions(user_id,source_user_id,level,amount_cents,position_id) values(sponsor,uid,lvl,comm,pos.id); perform public.wallet_delta(sponsor,'commission',comm,0,'commission:'||uid||':'||lvl,'Comissão de primeira compra · nível '||lvl); end if;
 sponsor:=(select referred_by from public.profiles where id=sponsor);
 end loop; end if;
 out:=jsonb_build_object('position_id',pos.id);
 elsif p_action='transfer' then
 if public.team_level(uid,target) is null then raise exception 'Destinatário fora da equipe'; end if;
 amt:=(p_data->>'amount_cents')::bigint;
 if amt is null or amt<1 then raise exception 'Valor inválido'; end if;
 if amt+coalesce((select sum(amount_cents) from public.transfers where sender_id=uid and (created_at at time zone 'America/Sao_Paulo')::date=(now() at time zone 'America/Sao_Paulo')::date),0)>10000 then raise exception 'Limite de transferência: R$100 por dia'; end if;
 perform 1 from public.wallets where user_id in (uid,target) order by user_id for update;
 perform public.wallet_delta(uid,'transfer',-amt,0,'transfer-out:'||rid,'Doação para afiliado');
 perform public.wallet_delta(target,'transfer',amt,0,'transfer-in:'||rid,'Saldo recebido da equipe');
 insert into public.transfers(sender_id,recipient_id,amount_cents) values(uid,target,amt);
 elsif p_action='withdrawal' then
 if not cfg.withdrawals_enabled then raise exception 'Saques desativados no momento'; end if;
 if not exists(select 1 from public.positions where user_id=uid and status in ('active','completed')) then raise exception 'Adquira um produto antes de sacar'; end if;
 amt:=(p_data->>'amount_cents')::bigint; if amt is null or amt<3000 or amt>1000000 then raise exception 'Saque entre R$30 e R$10.000'; end if;
 if exists(select 1 from public.withdrawals where user_id=uid and day_key=(now() at time zone 'America/Sao_Paulo')::date) then raise exception 'Você já solicitou um saque hoje'; end if;
 if length(coalesce(p_data->>'pix_key',''))<3 or length(p_data->>'pix_key')>200 then raise exception 'Chave Pix inválida'; end if;
 if p_data->>'pix_key_type' not in ('cpf','cnpj','email','phone','evp') then raise exception 'Tipo de chave inválido'; end if;
 if p_data->>'recipient_document' !~ '^[0-9]{11}$|^[0-9]{14}$' then raise exception 'CPF/CNPJ do destinatário obrigatório'; end if;
 insert into public.withdrawals(user_id,amount_cents,fee_cents,payout_cents,pix_key,pix_key_type,recipient_document) values(uid,amt,floor(amt::numeric*500/10000),amt-floor(amt::numeric*500/10000),p_data->>'pix_key',p_data->>'pix_key_type',p_data->>'recipient_document') returning * into wr;
 if cfg.auto_approve_withdrawals then update public.withdrawals set status='approved',approved_by=uid,updated_at=now() where id=wr.id; wr.status:='approved';wr.approved_by:=uid; end if;
 perform public.wallet_delta(uid,'withdrawal_requested',-amt,amt,'withdrawal-request:'||wr.id,'Saque solicitado; saldo reservado');out:=to_jsonb(wr);
 elsif p_action='profile' then
 update public.profiles set full_name=trim(p_data->>'full_name'),whatsapp=regexp_replace(p_data->>'whatsapp','[^0-9]','','g'),contact_consent=coalesce((p_data->>'contact_consent')::boolean,false),avatar_url=case when coalesce(p_data->>'avatar_url','') ~ '^https://' then p_data->>'avatar_url' else '' end where id=uid;
 elsif left(p_action,6)='admin_' then
 if not public.actor_admin() then raise exception 'Acesso administrativo negado'; end if;
 reason:=coalesce(p_data->>'reason','');
 if p_action='admin_product' then
 if nullif(p_data->>'id','') is null then
 insert into public.products(name,category,description,image,price_cents,daily_bps,duration_days,active) values(p_data->>'name',p_data->>'category',coalesce(p_data->>'description',''),p_data->>'image',(p_data->>'price_cents')::bigint,(p_data->>'daily_bps')::integer,(p_data->>'duration_days')::integer,(p_data->>'active')::boolean) returning jsonb_build_object('id',id) into out;
 else update public.products set name=p_data->>'name',category=p_data->>'category',description=coalesce(p_data->>'description',''),image=p_data->>'image',price_cents=(p_data->>'price_cents')::bigint,daily_bps=(p_data->>'daily_bps')::integer,duration_days=(p_data->>'duration_days')::integer,active=(p_data->>'active')::boolean where id=(p_data->>'id')::uuid; end if;
 elsif p_action='admin_settings' then
 if coalesce(p_data->>'whatsapp_group','')<>'' and p_data->>'whatsapp_group' !~ '^https://chat\.whatsapp\.com/[A-Za-z0-9/?=&_-]+$' then raise exception 'Link do grupo inválido'; end if;
 update public.platform_settings set withdrawals_enabled=(p_data->>'withdrawals_enabled')::boolean,auto_approve_withdrawals=coalesce((p_data->>'auto_approve_withdrawals')::boolean,auto_approve_withdrawals),commission_bps=array[(p_data->>'level1_bps')::integer,(p_data->>'level2_bps')::integer,(p_data->>'level3_bps')::integer],whatsapp_group=coalesce(p_data->>'whatsapp_group',''),return_principal=(p_data->>'return_principal')::boolean where id=1;
 elsif p_action='admin_user' then
 if target=uid and (p_data->>'blocked')::boolean then raise exception 'Não bloqueie sua própria conta'; end if;
 update public.profiles set full_name=trim(p_data->>'full_name'),whatsapp=regexp_replace(p_data->>'whatsapp','[^0-9]','','g'),blocked=(p_data->>'blocked')::boolean where id=target;
 elsif p_action='admin_balance' then
 if char_length(reason)<5 then raise exception 'Informe o motivo do ajuste'; end if;
 amt:=(p_data->>'amount_cents')::bigint; if amt is null or amt<0 then raise exception 'Saldo inválido'; end if;
 perform 1 from public.wallets where user_id=target for update;
 perform public.wallet_delta(target,'admin_adjustment',amt-(select available_cents from public.wallets where user_id=target),0,'admin-balance:'||rid,reason);
 elsif p_action='admin_position' then
 if char_length(reason)<5 then raise exception 'Informe o motivo'; end if;
 if nullif(p_data->>'id','') is null then
 select * into prod from public.products where id=(p_data->>'product_id')::uuid;
 if not found then raise exception 'Produto inválido'; end if;
 insert into public.positions(user_id,payer_id,product_id,name,category,image,principal_cents,daily_bps,duration_days,return_principal) values(target,uid,prod.id,prod.name,prod.category,prod.image,prod.price_cents,prod.daily_bps,prod.duration_days,cfg.return_principal);
 else
 select * into pos from public.positions where id=(p_data->>'id')::uuid for update;
 if (p_data->>'duration_days')::integer<pos.paid_periods then raise exception 'Prazo inferior aos períodos pagos'; end if;
 update public.positions set status=p_data->>'status',daily_bps=(p_data->>'daily_bps')::integer,duration_days=(p_data->>'duration_days')::integer where id=pos.id;
 end if;
 elsif p_action='admin_retry_withdrawal' then
 if not cfg.withdrawals_enabled then raise exception 'Ative os saques antes de repetir'; end if;
 select * into wr from public.withdrawals where id=(p_data->>'id')::uuid for update;
 if wr.status<>'review' then raise exception 'Somente saques em análise podem ser repetidos'; end if;
 if char_length(reason)<5 then raise exception 'Informe o motivo'; end if;
 update public.withdrawals set status='approved',approved_by=uid,last_error=null where id=wr.id;
 elsif p_action='admin_retry_event' then
 update public.webhook_inbox set status='pending',attempts=0,last_error=null where delivery_id=p_data->>'delivery_id' and status='review';
 elsif p_action='admin_approve_all' then
 if not cfg.withdrawals_enabled then raise exception 'Ative os saques antes de aprovar'; end if;
 update public.withdrawals set status='approved',approved_by=uid,updated_at=now() where status='requested';
 get diagnostics n=row_count;p_data:=p_data||jsonb_build_object('approved',n);out:=jsonb_build_object('approved',n);
 elsif p_action in ('admin_approve','admin_reject') then
 if p_action='admin_approve' and not cfg.withdrawals_enabled then raise exception 'Ative os saques antes de aprovar'; end if;
 for item in select value from jsonb_array_elements(p_data->'ids') loop
 select * into wr from public.withdrawals where id=(item#>>'{}')::uuid for update;
 if wr.status='requested' then
 if p_action='admin_approve' then update public.withdrawals set status='approved',approved_by=uid,updated_at=now() where id=wr.id;
 else perform public.wallet_delta(wr.user_id,'withdrawal_rejected',wr.amount_cents,-wr.amount_cents,'withdrawal-release:'||wr.id,'Saque rejeitado: '||reason);update public.withdrawals set status='rejected',last_error=reason,updated_at=now() where id=wr.id;end if;
 end if; end loop;
 else raise exception 'Ação administrativa desconhecida'; end if;
 insert into public.admin_audit(admin_id,action,details) values(uid,p_action,p_data-'pix_key'-'recipient_document');
 else raise exception 'Ação desconhecida'; end if;
 update public.app_requests set result=out where user_id=uid and request_id=rid;
 return out;
end; $$;
revoke all on function public.app_action_internal(text,jsonb) from public,anon,authenticated,service_role;

-- Migração: 202610090001_retry_failed_withdrawals.sql
create unique index withdrawals_one_active_per_day on public.withdrawals(user_id,day_key)
where status in ('requested','approved','processing','review','completed');
alter table public.withdrawals drop constraint withdrawals_user_id_day_key_key;

do $$
declare definition text;
  previous text := 'if exists(select 1 from public.withdrawals where user_id=uid and day_key=(now() at time zone ''America/Sao_Paulo'')::date) then raise exception ''Você já solicitou um saque hoje''; end if;';
  replacement text := 'if exists(select 1 from public.withdrawals where user_id=uid and day_key=(now() at time zone ''America/Sao_Paulo'')::date and status not in (''failed'',''rejected'')) then raise exception ''Você já solicitou um saque hoje''; end if;';
begin
 definition:=pg_get_functiondef('public.app_action_internal(text,jsonb)'::regprocedure);
 if length(definition)-length(replace(definition,previous,''))<>length(previous) then
  raise exception 'Versão inesperada de app_action_internal; migração recusada';
 end if;
 execute replace(definition,previous,replacement);
end $$;

-- Migração: 202610090002_coupons.sql
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

-- Migração: 202610090003_admin_position_counts.sql
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

-- Migração: 202610100001_community_and_welcome_notice.sql
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

-- Migração: 202610100002_admin_pagination_and_profiles.sql
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
