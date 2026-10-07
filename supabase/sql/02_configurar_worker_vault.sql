-- Execute no SQL Editor após habilitar Vault (supabase_vault) no Supabase.
-- Edite uma cópia privada; não salve o segredo real no projeto/Git.
-- O segredo aqui deve ser EXATAMENTE o WORKER_SECRET das Edge Functions.
begin;
do $$
declare
 worker_url text := 'https://SUBSTITUIR.supabase.co/functions/v1/process-payments';
 worker_secret text := 'SUBSTITUIR_POR_64_CARACTERES_ALEATORIOS';
 secret_uuid uuid;
begin
 if to_regclass('vault.secrets') is null then
  raise exception 'Habilite Vault no projeto Supabase antes de continuar';
 end if;
 if worker_url !~ '^https://[A-Za-z0-9.-]+/functions/v1/process-payments$' or worker_url ilike '%SUBSTITUIR%' then
  raise exception 'Informe a URL HTTPS real da função process-payments';
 end if;
 if length(worker_secret)<32 or worker_secret ~* 'SUBSTITUIR|^UM_SEGREDO' then
  raise exception 'Informe o WORKER_SECRET aleatório real (pelo menos 32 caracteres)';
 end if;
 select id into secret_uuid from vault.secrets where name='eletrify_worker_url';
 if secret_uuid is null then
  perform vault.create_secret(worker_url,'eletrify_worker_url','URL do worker Eletrify');
 else
  perform vault.update_secret(secret_uuid,worker_url,'eletrify_worker_url','URL do worker Eletrify');
 end if;
 select id into secret_uuid from vault.secrets where name='eletrify_worker_secret';
 if secret_uuid is null then
  perform vault.create_secret(worker_secret,'eletrify_worker_secret','Autenticação do worker Eletrify');
 else
  perform vault.update_secret(secret_uuid,worker_secret,'eletrify_worker_secret','Autenticação do worker Eletrify');
 end if;
end $$;
commit;
-- Nenhuma consulta acima devolve o segredo descriptografado.
