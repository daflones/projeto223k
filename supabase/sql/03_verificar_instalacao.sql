-- Consultas de diagnóstico, sem alteração de dados ou exposição de segredos.
-- Execute no SQL Editor após instalar. O perfil do navegador não deve ter
-- permissões diretas nestas tabelas: todas as ações passam pelas RPCs.
select c.relname as tabela,c.relrowsecurity as rls_ativo,
 has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') as anon_acesso_direto,
 has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') as usuario_acesso_direto
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in (
 'profiles','platform_settings','wallets','products','positions','ledger',
 'commissions','transfers','deposits','withdrawals','webhook_inbox','admin_audit','app_requests'
) order by c.relname;
-- Esperado: 13 tabelas, RLS=true e acesso direto=false nas duas colunas.

select p.proname as funcao,p.prosecdef as security_definer,p.proconfig as configuracao,
 has_function_privilege('anon',p.oid,'EXECUTE') as anon_executa,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as usuario_executa,
 has_function_privilege('service_role',p.oid,'EXECUTE') as servidor_executa
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('app_snapshot','app_action','app_action_internal',
 'actor_admin','wallet_delta','settle_deposit','settle_withdrawal','claim_withdrawals',
 'claim_webhook_events','process_yields','deposit_launch_amount','product_default_terms') order by p.proname;
-- Usuário executa somente app_snapshot e app_action. Anon: nenhuma destas.

select id,is_admin,blocked from public.profiles where is_admin is true;
select withdrawals_enabled,return_principal,commission_bps from public.platform_settings;
select pg_get_constraintdef((select oid from pg_constraint where conrelid='public.withdrawals'::regclass and conname='withdrawals_amount_cents_check')) as limite_saque;
select tgenabled='O' as trigger_deposito_ativa, pg_get_functiondef('public.deposit_launch_amount()'::regprocedure) ilike '%new.amount_cents<3500%' as minimo_35_presente
from pg_trigger where tgrelid='public.deposits'::regclass and tgname='deposit_launch_amount';
select category,duration_days,daily_bps,active,count(*) as produtos
from public.products group by category,duration_days,daily_bps,active order by category,daily_bps;
select status,count(*) as eventos from public.webhook_inbox group by status;
select status,count(*) as saques from public.withdrawals group by status;
select extname from pg_extension where extname in ('pg_cron','pg_net','supabase_vault');
-- Após cron.sql: pg_cron/pg_net/Vault presentes; conferir jobs no painel Cron.
-- Logs sem incluir o comando do job (que consulta o Vault):
-- select jobname,schedule,active from cron.job where jobname like 'eletrify-%';
-- select jobid,status,start_time,end_time from cron.job_run_details order by start_time desc limit 20;
