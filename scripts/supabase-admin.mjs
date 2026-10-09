import {readFile,readdir} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {randomBytes} from 'node:crypto';
import {installationSql,trackedInstallationSql} from './build-supabase-sql.mjs';

const {values} = parseArgs({options:{
  project:{type:'string'},'credentials-file':{type:'string'},origin:{type:'string'},
  'install-empty':{type:'boolean'},verify:{type:'boolean'},'inspect-backend':{type:'boolean'},
  'deploy-functions':{type:'boolean'},'configure-backend':{type:'boolean'},
  'configure-auth':{type:'boolean'},'configure-templates':{type:'boolean'},'verify-backend':{type:'boolean'},
  'apply-migrations':{type:'boolean'},'promote-admin':{type:'string'}
}});
if (!/^[a-z]{20}$/.test(values.project || '')) throw new Error('Informe --project com o project ref Supabase.');
const input = values['credentials-file'] ? await readFile(values['credentials-file'], 'utf8') : '';
const privateValue = name => process.env[name] || input.match(new RegExp(`^REFERENCIA_DO_SEGREDO_${name}\\s*=\\s*\\[([^\\]\\r\\n]+)\\]`, 'm'))?.[1]?.trim();
const token = process.env.SUPABASE_ACCESS_TOKEN || input.match(/^REFERENCIA_DO_SEGREDO_SUPABASE_ACCESS_TOKEN\s*=.*?\b(sbp_[a-zA-Z0-9]+)\b/m)?.[1];
if ((values['configure-backend'] || values['configure-auth']) && (!values.origin || new URL(values.origin).origin!==values.origin || !values.origin.startsWith('https://'))) {
  throw new Error('Informe --origin com a origem HTTPS final, sem caminho.');
}
if (!token) throw new Error('SUPABASE_ACCESS_TOKEN ausente. Forneça o token por canal privado.');

async function api(path, body, method = body ? 'POST' : 'GET') {
  const multipart = body instanceof FormData;
  const res = await fetch(`https://api.supabase.com/v1/projects/${values.project}${path}`, {
    method,
    headers:{Authorization:`Bearer ${token}`,...(multipart ? {} : {'Content-Type':'application/json'})},
    body:multipart ? body : body ? JSON.stringify(body) : undefined,
    signal:AbortSignal.timeout(120000)
  });
  if (!res.ok) {
    const detail = await res.text();
    const category = ['permission denied','read-only transaction','syntax error','does not exist','already exists','column reference','ambiguous','not unique','must be owner','unrecognized configuration','not available'].filter(message=>detail.toLowerCase().includes(message));
    const sqlstate = detail.match(/(?:SQLSTATE|code)[\s:'"]+([0-9A-Z]{5})\b/)?.[1];
    if (path==='/config/auth') {
      try {
        const message = JSON.parse(detail).message;
        if (typeof message==='string') console.error(message.replace(/\b(?:sbp_|sb_secret_|otp_live_|whsec_)[\w-]+/g,'[REDACTED]').slice(0,300));
      } catch {}
    }
    throw new Error(`Supabase HTTP ${res.status} em ${path}; categorias=${category.join(',')||'não classificada'}; SQLSTATE=${sqlstate||'não informado'}; resposta omitida.`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const functionNames = ['payments','mercosulpay-webhook','process-payments'];
const authSummary = auth => ({
  site_url:auth.site_url,uri_allow_list:auth.uri_allow_list,
  external_email_enabled:auth.external_email_enabled,mailer_autoconfirm:auth.mailer_autoconfirm,
  mailer_secure_email_change_enabled:auth.mailer_secure_email_change_enabled,
  smtp_custom_configured:Boolean(auth.smtp_host),rate_limit_email_sent:auth.rate_limit_email_sent,
  confirmation_template:Boolean(auth.mailer_templates_confirmation_content?.includes('Eletrify')),
  recovery_template:Boolean(auth.mailer_templates_recovery_content?.includes('Eletrify')),
  email_change_template:Boolean(auth.mailer_templates_email_change_content?.includes('Eletrify'))
});

try {
  const project = await api('');
  console.log(JSON.stringify({project:project.id,name:project.name,status:project.status,region:project.region}));
  const query = async sql => api('/database/query', {query:sql,read_only:true});
  const inventory = await query(`select jsonb_build_object(
    'tables',(select coalesce(jsonb_agg(tablename order by tablename),'[]'::jsonb) from pg_catalog.pg_tables where schemaname='public'),
    'history_table',to_regclass('supabase_migrations.schema_migrations')::text,
    'auth_users',(select count(*) from auth.users),
    'auth_triggers',(select coalesce(jsonb_agg(tgname),'[]'::jsonb) from pg_catalog.pg_trigger where tgrelid='auth.users'::regclass and not tgisinternal),
    'extensions',(select jsonb_agg(extname order by extname) from pg_catalog.pg_extension)
  ) as inventory`);
  console.log(JSON.stringify(inventory,null,2));
  if (inventory[0]?.inventory?.history_table) {
    console.log(JSON.stringify(await query('select version from supabase_migrations.schema_migrations order by version'),null,2));
  }
  if (values['inspect-backend']) {
    const functions = (await api('/functions')).map(({slug,status,version,verify_jwt})=>({slug,status,version,verify_jwt}));
    const secretNames = (await api('/secrets')).map(s=>s.name);
    const auth = authSummary(await api('/config/auth'));
    const vault = await query("select name from vault.secrets where name in ('eletrify_worker_url','eletrify_worker_secret') order by name");
    const cron = await query("select to_regclass('cron.job')::text as cron_table");
    console.log(JSON.stringify({functions,secretNames,auth,vault,cron},null,2));
  }
  if (values['install-empty']) {
    const state = inventory[0]?.inventory;
    if (!state || state.tables.length || state.auth_users || state.auth_triggers.length || state.history_table) {
      throw new Error('Instalação recusada: banco não está vazio.');
    }
    if (await readFile(new URL('../supabase/INSTALAR_ELETRIFY.sql',import.meta.url),'utf8') !== await installationSql()) {
      throw new Error('Instalador desatualizado: execute npm run build:sql e os testes.');
    }
    await api('/database/query', {query:await trackedInstallationSql(),read_only:false});
    console.log('Instalação SQL e histórico de migrações aplicados na mesma transação.');
  }
  if (values['apply-migrations']) {
    const dir = new URL('../supabase/migrations/', import.meta.url);
    const files = (await readdir(dir)).filter(name=>/^\d+_.+\.sql$/.test(name)).sort();
    const applied = new Set((await query('select version from supabase_migrations.schema_migrations')).map(r=>r.version));
    const pending = files.filter(f=>!applied.has(f.split('_')[0]));
    if (!pending.length) { console.log('Nenhuma migração pendente.'); }
    for (const file of pending) {
      const sql = await readFile(new URL(file, dir),'utf8');
      const version = file.split('_')[0];
      const record = `insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','${file.replaceAll("'","''")}',ARRAY['${sql.replaceAll("'","''")}']);`;
      await api('/database/query',{query:`begin;\n${sql.trim().replace(/^begin;/i,'').replace(/commit;\s*$/i,'').trim()}\n${record}\ncommit;`,read_only:false});
      console.log(`Aplicada: ${file}`);
    }
  }
  if (values['promote-admin']) {
    const uuid = values['promote-admin'];
    if (!/^[0-9a-f-]{36}$/i.test(uuid)) throw new Error('Informe --promote-admin com o UUID da conta.');
    const sql = (await readFile(new URL('../supabase/sql/01_promover_admin.sql',import.meta.url),'utf8'))
      .replace('00000000-0000-0000-0000-000000000000',uuid);
    await api('/database/query',{query:sql,read_only:false});
    const check = await query('select p.is_admin,p.blocked,u.email_confirmed_at is not null confirmed from public.profiles p join auth.users u on u.id=p.id where p.id='+`'${uuid}'`);
    console.log(JSON.stringify(check));
    if (!check[0]?.is_admin) throw new Error('Promoção não aplicada.');
  }
  if (values['deploy-functions']) {
    for (const name of functionNames) {
      const form = new FormData();
      form.append('metadata',JSON.stringify({name,entrypoint_path:`${name}/index.ts`,verify_jwt:false}));
      for (const file of [`${name}/index.ts`,'_shared/backend.ts','_shared/money.js']) {
        form.append('file',new Blob([await readFile(new URL(`../supabase/functions/${file}`,import.meta.url))],{type:'application/typescript'}),file);
      }
      const deployed = await api(`/functions/deploy?slug=${name}`,form);
      console.log(JSON.stringify({deployed:deployed.slug,status:deployed.status,version:deployed.version,verify_jwt:deployed.verify_jwt}));
    }
  }
  if (values['configure-backend']) {
    console.log('Conferindo bloqueios e filas antes da configuração.');
    const [{safe}] = await query(`select
      not (select withdrawals_enabled from public.platform_settings where id=1)
      and not exists(select 1 from public.products where active)
      and not exists(select 1 from public.withdrawals)
      and not exists(select 1 from public.deposits)
      and not exists(select 1 from public.webhook_inbox) as safe`);
    if (!safe) throw new Error('Configuração inicial exige catálogo e saques desativados e filas vazias.');
    const key = privateValue('MERCOSULPAY_API_KEY');
    const webhook = privateValue('MERCOSULPAY_WEBHOOK_SECRET');
    if (!key || !webhook || /PREENCHER|SUBSTITUIR/.test(key+webhook)) throw new Error('Credenciais MercosulPay ausentes.');
    console.log('Preparando segredo do worker em memória.');
    const existing = await query("select name from vault.secrets where name='eletrify_worker_secret'");
    if (existing.length) throw new Error('Worker já configurado no Vault. Não substituímos nem lemos o segredo existente.');
    const worker = randomBytes(32).toString('hex');
    await api('/secrets',[
      {name:'MERCOSULPAY_API_KEY',value:key},{name:'MERCOSULPAY_WEBHOOK_SECRET',value:webhook},
      {name:'WORKER_SECRET',value:worker},{name:'APP_URL',value:values.origin},
      {name:'APP_ORIGINS',value:`${values.origin},http://localhost:5173,http://localhost:3000`}
    ]);
    let vaultSql = await readFile(new URL('../supabase/sql/02_configurar_worker_vault.sql',import.meta.url),'utf8');
    vaultSql = vaultSql.replace('https://SUBSTITUIR.supabase.co/functions/v1/process-payments',`https://${values.project}.supabase.co/functions/v1/process-payments`).replace('SUBSTITUIR_POR_64_CARACTERES_ALEATORIOS',worker);
    await api('/database/query',{query:vaultSql,read_only:false});
    console.log('Secrets das funções e Vault configurados sem gravar valores localmente.');
    const cronTable = await query("select to_regclass('cron.job')::text as name");
    if (cronTable[0]?.name) {
      const existingJobs = await query("select jobname from cron.job where jobname in ('eletrify-yields','eletrify-payments')");
      if (existingJobs.length) throw new Error('Jobs Eletrify já existem; não foram substituídos. Verifique o agendamento existente.');
    }
    await api('/database/query',{query:await readFile(new URL('../supabase/cron.sql',import.meta.url),'utf8'),read_only:false});
    console.log('Cron de rendimentos e worker instalado. Catálogo e saques continuam desativados.');
  }
  if (values['configure-auth']) {
    const origins = [values.origin,'http://localhost:5173','http://localhost:3000'];
    const redirects = origins.flatMap(origin=>[origin,origin+'/',origin+'/?flow=recovery']).join(',');
    await api('/config/auth',{
      site_url:values.origin,uri_allow_list:redirects,
      external_email_enabled:true,mailer_autoconfirm:false,mailer_secure_email_change_enabled:true
    },'PATCH');
    const auth = await api('/config/auth');
    if (auth.site_url!==values.origin || auth.uri_allow_list!==redirects || auth.mailer_autoconfirm!==false
      || !auth.external_email_enabled || !auth.mailer_secure_email_change_enabled) throw new Error('Verificação da configuração Auth falhou.');
    console.log(JSON.stringify({auth:authSummary(auth)},null,2));
  }
  if (values['configure-templates']) {
    const templates = {
      mailer_templates_confirmation_content:await readFile(new URL('../supabase/templates/confirm-signup.html',import.meta.url),'utf8'),
      mailer_templates_recovery_content:await readFile(new URL('../supabase/templates/reset-password.html',import.meta.url),'utf8'),
      mailer_templates_email_change_content:await readFile(new URL('../supabase/templates/change-email.html',import.meta.url),'utf8')
    };
    await api('/config/auth',{
      ...templates,mailer_subjects_confirmation:'Confirme seu cadastro na Eletrify',
      mailer_subjects_recovery:'Redefina sua senha na Eletrify',mailer_subjects_email_change:'Confirme a alteração de e-mail na Eletrify'
    },'PATCH');
    const auth = await api('/config/auth');
    if (Object.entries(templates).some(([key,value])=>auth[key]!==value)) throw new Error('Verificação dos templates falhou.');
    console.log('Templates de e-mail configurados e verificados.');
  }
  if (values['verify-backend']) {
    const deployed = (await api('/functions')).filter(f=>functionNames.includes(f.slug));
    console.log(JSON.stringify({functions:deployed.map(({slug,status,version,verify_jwt})=>({slug,status,version,verify_jwt}))},null,2));
    if (deployed.length!==3 || deployed.some(f=>f.status!=='ACTIVE'||f.verify_jwt!==false)) throw new Error('Deploy das funções incompleto.');
    for (const [name,expected] of [['payments',401],['mercosulpay-webhook',401],['process-payments',403]]) {
      const response = await fetch(`https://${values.project}.supabase.co/functions/v1/${name}`,{
        method:'POST',headers:{'Content-Type':'application/json',Origin:values.origin||'https://eletrify.me'},
        body:'{}',signal:AbortSignal.timeout(30000)
      });
      console.log(JSON.stringify({endpoint:name,unauthorized_status:response.status,expected}));
      if (response.status!==expected) throw new Error('Verificação de autorização da função falhou.');
    }
    const publicKey = process.env.SUPABASE_ANON_KEY || input.match(/^SUPABASE_CHAVE_PUBLICA\s*=\s*\[([^\]\r\n]+)\]/m)?.[1]?.trim();
    if (publicKey) {
      const authResponse = await fetch(`https://${values.project}.supabase.co/auth/v1/settings`,{headers:{apikey:publicKey},signal:AbortSignal.timeout(30000)});
      if (authResponse.status!==200) throw new Error('Chave pública não validada no Auth.');
      const tableResponse = await fetch(`https://${values.project}.supabase.co/rest/v1/wallets?select=user_id&limit=1`,{headers:{apikey:publicKey},signal:AbortSignal.timeout(30000)});
      console.log(JSON.stringify({public_auth_status:authResponse.status,anonymous_wallet_access_status:tableResponse.status}));
      if (![401,403].includes(tableResponse.status)) throw new Error('Acesso anônimo à carteira não foi negado.');
    }
    console.log(JSON.stringify({jobs:await query("select jobname,schedule,active from cron.job where jobname in ('eletrify-yields','eletrify-payments') order by jobname"),
      runs:await query("select j.jobname,r.status,r.start_time,r.end_time from cron.job_run_details r join cron.job j using(jobid) where j.jobname in ('eletrify-yields','eletrify-payments') order by r.start_time desc limit 6"),
      http:await query('select id,status_code,timed_out,created from net._http_response order by created desc limit 6'),
      auth:authSummary(await api('/config/auth'))},null,2));
  }
  if (values.verify || values['install-empty']) {
    const tables = await query(`select c.relname,c.relrowsecurity,
      has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') as anon_access,
      has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') as user_access
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='r' order by c.relname`);
    const functions = await query(`select p.proname,p.prosecdef,p.proconfig,
      has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
      has_function_privilege('authenticated',p.oid,'EXECUTE') as user_execute,
      pg_catalog.pg_get_userbyid(p.proowner) as owner
      from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' order by p.proname`);
    const settings = await query('select withdrawals_enabled,return_principal,commission_bps from public.platform_settings');
    const catalog = await query('select name,category,price_cents,daily_bps,duration_days,active from public.products order by category,price_cents');
    const history = await query('select version,name from supabase_migrations.schema_migrations order by version');
    const limits = await query(`select
      pg_get_constraintdef((select oid from pg_constraint where conrelid='public.withdrawals'::regclass and conname='withdrawals_amount_cents_check')) as withdrawal_constraint,
      position('amt<3000' in pg_get_functiondef('public.app_action_internal(text,jsonb)'::regprocedure))>0 as withdrawal_rpc_minimum,
      position('new.amount_cents<3500' in pg_get_functiondef('public.deposit_launch_amount()'::regprocedure))>0 as deposit_trigger_minimum,
      exists(select 1 from pg_trigger where tgrelid='public.deposits'::regclass and tgname='deposit_launch_amount' and tgenabled='O') as deposit_trigger_enabled`);
    const retryRule = history.some(m=>m.version==='202610090001') ? await query(`select
      exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid where c.relname='withdrawals_one_active_per_day' and i.indisunique and i.indpred is not null and pg_get_expr(i.indpred,i.indrelid) not ilike '%failed%' and pg_get_expr(i.indpred,i.indrelid) not ilike '%rejected%') as partial_unique,
      not exists(select 1 from pg_constraint where conrelid='public.withdrawals'::regclass and conname='withdrawals_user_id_day_key_key') as old_constraint_removed,
      position('status not in (''failed'',''rejected'')' in pg_get_functiondef('public.app_action_internal(text,jsonb)'::regprocedure))>0 as failed_retry_enabled`) : [];
    const counts = await query(`select
      (select count(*) from auth.users) as users,
      (select count(*) from public.profiles where is_admin) as admins,
      (select count(*) from public.positions) as positions,
      (select count(*) from public.deposits) as deposits,
      (select count(*) from public.withdrawals) as withdrawals,
      (select count(*) from public.ledger) as ledger_entries`);
    console.log(JSON.stringify({tables,functions,settings,catalog,history,limits,retryRule,counts},null,2));
    if (retryRule.length && (!retryRule[0].partial_unique || !retryRule[0].old_constraint_removed || !retryRule[0].failed_retry_enabled)) throw new Error('Regra de nova tentativa de saque não verificada.');
    const couponsInstalled=history.some(m=>m.version==='202610090002');
    if (tables.length!==(couponsInstalled?16:13) || tables.some(t=>!t.relrowsecurity||t.anon_access||t.user_access)
      || functions.some(f=>f.anon_execute!==(f.proname==='referral_lookup')
        || f.user_execute!==['app_action','app_snapshot','referral_lookup',...(couponsInstalled?['coupon_admin_save','coupon_admin_list','coupon_preview','coupon_redeem']:[])].includes(f.proname))
      || !limits[0]?.withdrawal_rpc_minimum || !limits[0]?.deposit_trigger_minimum || !limits[0]?.deposit_trigger_enabled) {
      throw new Error('Verificação de permissões ou limites falhou.');
    }
    console.log('Verificação remota de RLS, permissões e limites aprovada.');
  }
} catch (error) {
  console.error(error.message.startsWith('Supabase HTTP') ? error.message : 'Falha ao consultar Supabase; detalhes omitidos para proteger credenciais.');
  process.exitCode = 1;
}
