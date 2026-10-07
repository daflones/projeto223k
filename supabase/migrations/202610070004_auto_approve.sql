begin;

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

commit;
