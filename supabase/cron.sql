-- Execute no SQL Editor após as migrações, deploy das funções e configuração
-- de supabase/sql/02_configurar_worker_vault.sql. Pode ser repetido: substitui
-- somente os dois jobs da Eletrify, sem duplicá-los.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
do $$
declare worker_url text; worker_secret text; existing_job bigint;
begin
 if to_regclass('vault.decrypted_secrets') is null then
  raise exception 'Habilite Vault e configure os dois segredos do worker primeiro';
 end if;
 select decrypted_secret into worker_url from vault.decrypted_secrets where name='eletrify_worker_url';
 select decrypted_secret into worker_secret from vault.decrypted_secrets where name='eletrify_worker_secret';
 if worker_url is null or worker_url !~ '^https://[A-Za-z0-9.-]+/functions/v1/process-payments$' or worker_url ilike '%SUBSTITUIR%' then
  raise exception 'Configure eletrify_worker_url com a URL HTTPS real';
 end if;
 if worker_secret is null or length(worker_secret)<32 or worker_secret ~* 'SUBSTITUIR|^UM_SEGREDO' then
  raise exception 'Configure eletrify_worker_secret com o WORKER_SECRET real';
 end if;
 for existing_job in select jobid from cron.job where jobname in ('eletrify-yields','eletrify-payments') loop
  perform cron.unschedule(existing_job);
 end loop;
end $$;
-- Catch-up de períodos completos de 24h por aquisição, com devolução no vencimento.
select cron.schedule('eletrify-yields','*/5 * * * *','select public.process_yields();');
-- Inbox durável, conciliação e envio dos saques previamente aprovados.
select cron.schedule('eletrify-payments','* * * * *',$job$
 select net.http_post(
  url:=(select decrypted_secret from vault.decrypted_secrets where name='eletrify_worker_url'),
  headers:=jsonb_build_object('Content-Type','application/json','x-worker-secret',(select decrypted_secret from vault.decrypted_secrets where name='eletrify_worker_secret')),
  body:='{}'::jsonb,timeout_milliseconds:=30000
 );
$job$);
commit;
-- Conferir cron.job_run_details e status HTTP em net._http_response.
