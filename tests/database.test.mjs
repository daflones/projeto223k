import test from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';import {readFile} from 'node:fs/promises';
const migration=await readFile(new URL('../supabase/migrations/202610060001_platform.sql',import.meta.url),'utf8');
const catalog=await readFile(new URL('../supabase/migrations/202610060002_catalog.sql',import.meta.url),'utf8');
const terms=await readFile(new URL('../supabase/migrations/202610060003_investment_terms.sql',import.meta.url),'utf8');
const security=await readFile(new URL('../supabase/migrations/202610060004_admin_and_webhook_queue.sql',import.meta.url),'utf8');
const launch=await readFile(new URL('../supabase/migrations/202610070001_launch_rules.sql',import.meta.url),'utf8');
const bootstrap=`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`;
let db;
const ids={root:'00000000-0000-4000-8000-000000000001',admin:'00000000-0000-4000-8000-000000000002',child:'00000000-0000-4000-8000-000000000003',grand:'00000000-0000-4000-8000-000000000004'};
let serial=10;const req=()=>`00000000-0000-4000-8000-${String(serial++).padStart(12,'0')}`;
async function as(id){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);}
async function act(name,data){return (await db.query('select public.app_action($1,$2::jsonb) result',[name,JSON.stringify({request_id:req(),...data})])).rows[0].result;}
async function wallet(id){return (await db.query('select * from public.wallets where user_id=$1',[id])).rows[0];}
const amount=x=>Number(x);
await test('Database financial flows and authorization',async t=>{
 db=new PGlite();await db.exec(bootstrap);
 await db.exec(migration);
 await db.exec(catalog);await db.exec(terms);await db.exec(security);await db.exec(launch);
 await t.test('Launch catalog and missing product terms follow category defaults',async()=>{
  const settings=(await db.query('select * from public.platform_settings')).rows[0];
  assert.equal(settings.return_principal,true);assert.equal(settings.withdrawals_enabled,false);
  assert.deepEqual(settings.commission_bps,[1500,500,200]);
  const audit=(await db.query("select * from public.admin_audit where action='launch_rules'")).rows;
  assert.equal(audit.length,1);assert.equal(audit[0].admin_id,null);
  assert.deepEqual(audit[0].details.commission_bps,[1500,500,200]);
  assert.deepEqual(audit[0].details.previous_commission_bps,[1500,0,0]);
  assert.equal(audit[0].details.withdrawal_min_cents,3000);assert.equal(audit[0].details.deposit_min_cents,3500);
  await db.exec('begin;delete from public.platform_settings;insert into public.platform_settings(id) values(1);');
  assert.deepEqual((await db.query('select commission_bps from public.platform_settings')).rows[0].commission_bps,[1500,500,200]);
  await db.exec('rollback;');
  const initial=(await db.query('select category,daily_bps,duration_days,active from public.products order by category,price_cents')).rows;
  assert.equal(initial.length,8);
  for(const category of ['production','distribution']){
   const ps=initial.filter(p=>p.category===category);
   assert.deepEqual(ps.map(p=>p.daily_bps),[500,600,700,800]);
   assert(ps.every(p=>p.duration_days===(category==='production'?10:15)&&!p.active));
  }
  for(const category of ['production','distribution']){
   const p=(await db.query('insert into public.products(name,category,image,price_cents) values($1,$2,$3,$4) returning *',['Default '+category,category,'/assets/default-test.png',10000])).rows[0];
   assert.equal(p.daily_bps,500);assert.equal(p.duration_days,category==='production'?10:15);
  }
 });
 async function add(id,name,ref){await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3::jsonb)',[id,name+'@example.test',JSON.stringify({full_name:name,whatsapp:'21999999999',referral_code:ref||'',contact_consent:true,is_admin:true,role:'admin'})]);}
 await add(ids.root,'Root');await add(ids.admin,'Admin');const ref=(await db.query('select referral_code from public.profiles where id=$1',[ids.root])).rows[0].referral_code;await add(ids.child,'Child',ref);const ref2=(await db.query('select referral_code from public.profiles where id=$1',[ids.child])).rows[0].referral_code;await add(ids.grand,'Grand',ref2);
 await t.test('Signup metadata cannot grant admin and the browser cannot promote itself',async()=>{
  assert((await db.query('select is_admin from public.profiles')).rows.every(p=>p.is_admin===false));
  await as(ids.root);await db.exec('set role authenticated');
  try{
   const snap=(await db.query('select public.app_snapshot(false) result')).rows[0].result;
   assert.equal(snap.profile.is_admin,false);assert.equal(snap.admin,undefined);
   await assert.rejects(db.query('update public.profiles set is_admin=true where id=$1',[ids.root]),/permission denied/);
   await assert.rejects(db.query('select public.app_action_internal($1,$2::jsonb)',['admin_settings','{}']),/permission denied/);
   for(const name of ['admin_product','admin_settings','admin_user','admin_balance','admin_position','admin_approve','admin_reject','admin_retry_event','admin_retry_withdrawal']){
    await assert.rejects(act(name,{is_admin:true}),/negado/);
   }
  }finally{await db.exec('reset role');}
 });
 await db.exec("update public.profiles set is_admin=true where full_name='Admin';update public.platform_settings set withdrawals_enabled=true,commission_bps='{1500,300,100}';");
 await t.test('Current is_admin controls access including cached requests after revocation',async()=>{
  await as(ids.admin);const rid=req();const settings={request_id:rid,withdrawals_enabled:true,return_principal:true,level1_bps:1500,level2_bps:300,level3_bps:100,whatsapp_group:''};
  assert((await db.query('select public.app_snapshot(true) result')).rows[0].result.admin);
  await act('admin_settings',settings);
  await db.query('update public.profiles set is_admin=false where id=$1',[ids.admin]);
  await assert.rejects(db.query('select public.app_snapshot(true)'),/negado/);
  await assert.rejects(act('admin_settings',settings),/negado/);
  await db.query('update public.profiles set is_admin=true,blocked=true where id=$1',[ids.admin]);
  await assert.rejects(db.query('select public.app_snapshot(true)'),/suspensa/);
  await assert.rejects(act('admin_settings',settings),/negado/);
  await db.query('update public.profiles set blocked=false where id=$1',[ids.admin]);
  await act('admin_settings',settings);
 });
 await t.test('Webhook leases prevent repeat claims and stale result overwrites',async()=>{
  await db.exec("insert into public.webhook_inbox(delivery_id,event,payload) values('delivery-1','pix.received','{}'),('delivery-2','pix.sent','{}');");
  const first=(await db.query('select * from public.claim_webhook_events(1)')).rows[0];
  assert.equal(first.status,'processing');assert.equal(first.attempts,1);assert(first.claim_token);
  const second=(await db.query('select * from public.claim_webhook_events(1)')).rows[0];
  assert.notEqual(first.delivery_id,second.delivery_id);
  assert.equal((await db.query('select * from public.claim_webhook_events(20)')).rows.length,0);
  await db.query("update public.webhook_inbox set claimed_at=now()-interval '11 minutes' where delivery_id=$1",[first.delivery_id]);
  const reclaimed=(await db.query('select * from public.claim_webhook_events(20)')).rows[0];
  assert.equal(reclaimed.delivery_id,first.delivery_id);assert.notEqual(reclaimed.claim_token,first.claim_token);assert.equal(reclaimed.attempts,2);
  assert.equal((await db.query("update public.webhook_inbox set status='processed' where delivery_id=$1 and claim_token=$2 returning *",[first.delivery_id,first.claim_token])).rows.length,0);
  await assert.rejects(db.query("insert into public.webhook_inbox(delivery_id,event,payload) values($1,'pix.received','{}')",[first.delivery_id]),/duplicate key/);
  await db.exec('set role authenticated');
  try{await assert.rejects(db.query('select * from public.claim_webhook_events(20)'),/permission denied/);}finally{await db.exec('reset role');}
 });
 await as(ids.admin);await act('admin_balance',{user_id:ids.child,amount_cents:100000,reason:'Crédito para teste'});await act('admin_balance',{user_id:ids.grand,amount_cents:100000,reason:'Crédito para teste'});
 const product=(await act('admin_product',{name:'Produto teste',category:'production',description:'Teste',image:'/assets/example.png',price_cents:10000,daily_bps:100,duration_days:3,active:true})).id;
 await t.test('Purchase snapshots terms and first commission is paid once',async()=>{await as(ids.child);const rid=req();await act('purchase',{product_id:product,quantity:1,request_id:rid});const before=await wallet(ids.child);await act('purchase',{product_id:product,quantity:1,request_id:rid});assert.equal(amount((await wallet(ids.child)).available_cents),amount(before.available_cents));assert.equal(amount((await wallet(ids.root)).available_cents),1500);await act('purchase',{product_id:product,quantity:1});assert.equal(amount((await wallet(ids.root)).available_cents),1500);});
 await t.test('Grandchild first purchase pays level 2 to root',async()=>{await as(ids.grand);await act('purchase',{product_id:product,quantity:2});assert.equal(amount((await wallet(ids.root)).available_cents),1800);assert.equal((await db.query('select count(*) n from public.commissions')).rows[0].n,3);});
 await t.test('Insufficient balance rolls back purchase and position',async()=>{await as(ids.root);const count=(await db.query('select count(*) n from public.positions')).rows[0].n;await assert.rejects(act('purchase',{product_id:product,quantity:1}),/wallets_available_cents_check/);assert.equal((await db.query('select count(*) n from public.positions')).rows[0].n,count);});
 await t.test('Withdrawal boundaries, fee, idempotency, daily limit and rejection refund',async()=>{
  await as(ids.child);const before=await wallet(ids.child);
  const data={pix_key:'12345678901',pix_key_type:'cpf',recipient_document:'12345678901'};
  const counts=async()=> (await db.query('select (select count(*) from public.withdrawals) withdrawals,(select count(*) from public.ledger) ledger,(select count(*) from public.app_requests) requests')).rows[0];
  const initial=await counts();
  for(const cents of [2999,1000001]){
   await assert.rejects(act('withdrawal',{...data,amount_cents:cents}),/Saque entre R\$30 e R\$10.000/);
   assert.deepEqual(await wallet(ids.child),before);assert.deepEqual(await counts(),initial);
   await assert.rejects(db.query('insert into public.withdrawals(user_id,amount_cents,fee_cents,payout_cents,pix_key,pix_key_type,recipient_document) values($1,$2,0,$2,$3,$4,$3)',[ids.child,cents,data.pix_key,data.pix_key_type]),/withdrawals_amount_cents_check/);
  }
  const request_id=req();const w=await act('withdrawal',{...data,amount_cents:3000,request_id});
  assert.equal(amount(w.fee_cents),150);assert.equal(amount(w.payout_cents),2850);
  assert.equal(amount((await wallet(ids.child)).available_cents),amount(before.available_cents)-3000);
  assert.equal(amount((await wallet(ids.child)).reserved_cents),3000);
  const after=await counts();assert.deepEqual(await act('withdrawal',{...data,amount_cents:3000,request_id}),w);assert.deepEqual(await counts(),after);
  await assert.rejects(act('withdrawal',{...data,amount_cents:3000}),/já solicitou/);
  await as(ids.admin);await act('admin_reject',{ids:[w.id],reason:'Rejeição de teste'});
  assert.deepEqual(await wallet(ids.child),before);
  await db.exec('begin;');
  try{
   await db.query('update public.wallets set available_cents=1000000 where user_id=$1',[ids.grand]);await as(ids.grand);
   const max=await act('withdrawal',{...data,amount_cents:1000000});assert.equal(amount(max.fee_cents),50000);assert.equal(amount(max.payout_cents),950000);
  }finally{await db.exec('rollback;');}
 });
 await t.test('Transfer aggregated R$100/day, eligibility and idempotent credits',async()=>{await as(ids.root);await act('transfer',{user_id:ids.child,amount_cents:1000});await assert.rejects(act('transfer',{user_id:ids.child,amount_cents:9100}),/Limite de transferência/);await assert.rejects(act('transfer',{user_id:ids.admin,amount_cents:1}),/fora da equipe/);});
 await t.test('24h yield catch-up and principal pay once, independently of catalog',async()=>{await db.exec("update public.positions set created_at=now()-interval '3 days' where user_id='"+ids.child+"';update public.products set daily_bps=200;");const before=await wallet(ids.child);await db.query('select public.process_yields()');const after=await wallet(ids.child);assert.equal(amount(after.available_cents)-amount(before.available_cents),20600);assert.equal((await db.query("select count(*) n from public.ledger where user_id=$1 and kind='principal_return'",[ids.child])).rows[0].n,2);await db.query('select public.process_yields()');assert.equal(amount((await wallet(ids.child)).available_cents),amount(after.available_cents));});
 await t.test('Deposit amount boundaries reject invalid creations and amount updates without financial events',async()=>{
  const before=await wallet(ids.child);
  const counts=async()=> (await db.query('select (select count(*) from public.deposits) deposits,(select count(*) from public.ledger) ledger,(select count(*) from public.app_requests) requests')).rows[0];
  const initial=await counts();
  for(const cents of [3499,500001]){
   await assert.rejects(db.query("insert into public.deposits(user_id,amount_cents,status) values($1,$2,'pending')",[ids.child,cents]),/Depósito entre R\$35 e R\$5.000/);
   assert.deepEqual(await wallet(ids.child),before);assert.deepEqual(await counts(),initial);
  }
  for(const cents of [3500,500000]){
   const deposit=(await db.query("insert into public.deposits(user_id,amount_cents,status) values($1,$2,'pending') returning *",[ids.child,cents])).rows[0];
   for(const invalid of [3499,500001]) await assert.rejects(db.query('update public.deposits set amount_cents=$1 where id=$2',[invalid,deposit.id]),/Depósito entre R\$35 e R\$5.000/);
   assert.equal(amount((await db.query('select amount_cents from public.deposits where id=$1',[deposit.id])).rows[0].amount_cents),cents);
  }
  assert.deepEqual(await wallet(ids.child),before);const after=await counts();assert.equal(after.ledger,initial.ledger);assert.equal(after.requests,initial.requests);
 });
 await t.test('Deposit credits completed only and duplicate delivery cannot double credit',async()=>{const id=req();await db.query('insert into public.deposits(id,user_id,amount_cents,provider_id,status) values($1,$2,3500,$3,$4)',[id,ids.child,'provider-123','pending']);const before=await wallet(ids.child);await db.query('select public.settle_deposit($1,$2,$3,$4,$5)',[id,'provider-123',3500,'pending',10]);assert.equal(amount((await wallet(ids.child)).available_cents),amount(before.available_cents));await db.query('select public.settle_deposit($1,$2,$3,$4,$5)',[id,'provider-123',3500,'completed',10]);await db.query('select public.settle_deposit($1,$2,$3,$4,$5)',[id,'provider-123',3500,'completed',10]);assert.equal(amount((await wallet(ids.child)).available_cents),amount(before.available_cents)+3500);await assert.rejects(db.query('select public.settle_deposit($1,$2,$3,$4,$5)',[id,'wrong',3500,'completed',10]),/divergente/);});
 await t.test('Regular user cannot access admin or privileged financial functions',async()=>{await as(ids.child);await assert.rejects(db.query('select public.app_snapshot(true)'),/negado/);await assert.rejects(act('admin_balance',{user_id:ids.root,amount_cents:999999,reason:'Exploit test'}),/negado/);await db.exec('set role authenticated');await assert.rejects(db.query('select public.process_yields()'),/permission denied/);await assert.rejects(db.query('select * from public.wallets'),/permission denied/);await db.exec('reset role');});
 await t.test('Withdrawal settlement requires approved state and releases reservation exactly once',async()=>{await as(ids.grand);const w=await act('withdrawal',{amount_cents:10000,pix_key:'12345678901',pix_key_type:'cpf',recipient_document:'12345678901'});await assert.rejects(db.query('select public.settle_withdrawal($1,$2,$3,$4)',[w.id,'completed','provider-w',9600]),/não autorizado/);await as(ids.admin);await act('admin_approve',{ids:[w.id]});await db.query('select public.claim_withdrawals(20)');await db.query('select public.settle_withdrawal($1,$2,$3,$4)',[w.id,'completed','provider-w',9600]);await db.query('select public.settle_withdrawal($1,$2,$3,$4)',[w.id,'completed','provider-w',9600]);assert.equal(amount((await wallet(ids.grand)).reserved_cents),0);});
 await t.test('10/15 day maturity returns each principal with the last yield and no duplicates',async()=>{
  await as(ids.admin);await act('admin_balance',{user_id:ids.admin,amount_cents:100000,reason:'Crédito de teste de vencimento'});
  const production=(await act('admin_product',{name:'Vencimento produção',category:'production',image:'/assets/test.png',price_cents:10000,daily_bps:500,duration_days:10,active:true})).id;
  const distribution=(await act('admin_product',{name:'Vencimento distribuição',category:'distribution',image:'/assets/test.png',price_cents:10000,daily_bps:600,duration_days:15,active:true})).id;
  await act('purchase',{product_id:production,quantity:2});await act('purchase',{product_id:distribution,quantity:1});
  await db.query("update public.positions set created_at=now()-interval '9 days 23 hours' where user_id=$1",[ids.admin]);
  await db.query('select public.process_yields()');
  assert.equal(amount((await wallet(ids.admin)).available_cents),84400);
  assert.equal((await db.query('select count(*) n from public.positions where user_id=$1 and principal_returned',[ids.admin])).rows[0].n,0);
  await db.query("update public.positions set created_at=now()-interval '10 days' where user_id=$1 and product_id=$2",[ids.admin,production]);
  await db.query("update public.positions set created_at=now()-interval '14 days 23 hours' where user_id=$1 and product_id=$2",[ids.admin,distribution]);
  await db.query('select public.process_yields()');
  assert.equal(amount((await wallet(ids.admin)).available_cents),108400);
  assert.equal((await db.query('select count(*) n from public.positions where user_id=$1 and principal_returned',[ids.admin])).rows[0].n,2);
  await db.query("update public.positions set created_at=now()-interval '15 days' where user_id=$1 and product_id=$2",[ids.admin,distribution]);
  await db.query('select public.process_yields()');
  assert.equal(amount((await wallet(ids.admin)).available_cents),119000);
  await db.query('select public.process_yields()');await db.query('select public.process_yields()');
  assert.equal(amount((await wallet(ids.admin)).available_cents),119000);
  assert.equal((await db.query("select count(*) n from public.ledger where user_id=$1 and kind='principal_return'",[ids.admin])).rows[0].n,3);
  const positions=(await db.query('select * from public.positions where user_id=$1',[ids.admin])).rows;
  assert(positions.every(p=>p.status==='completed'&&p.principal_returned));
  assert.equal(positions.reduce((sum,p)=>sum+amount(p.earned_cents),0),19000);
 });
 await t.test('Admin can edit price/rate/duration and return policy without rewriting purchased terms',async()=>{
  await as(ids.admin);
  const old=(await db.query("select * from public.positions where user_id=$1 and category='production' limit 1",[ids.admin])).rows[0];
  await act('admin_product',{id:old.product_id,name:'Termos atualizados',category:'production',image:'/assets/test.png',price_cents:20000,daily_bps:750,duration_days:12,active:true});
  const settings=return_principal=>({withdrawals_enabled:true,return_principal,level1_bps:1500,level2_bps:300,level3_bps:100,whatsapp_group:''});
  await act('admin_settings',settings(false));await act('purchase',{product_id:old.product_id,quantity:1});
  const position=(await db.query("select * from public.positions where user_id=$1 and status='active'",[ids.admin])).rows[0];
  assert.equal(position.duration_days,12);assert.equal(position.daily_bps,750);assert.equal(amount(position.principal_cents),20000);assert.equal(position.return_principal,false);
  await act('admin_settings',settings(true));
  const original=(await db.query('select * from public.positions where id=$1',[old.id])).rows[0];
  assert.equal(original.duration_days,10);assert.equal(original.daily_bps,500);assert.equal(original.return_principal,true);
  const before=amount((await wallet(ids.admin)).available_cents);
  await db.query("update public.positions set created_at=now()-interval '12 days' where id=$1",[position.id]);
  await db.query('select public.process_yields()');
  assert.equal(amount((await wallet(ids.admin)).available_cents)-before,18000);
  assert.equal((await db.query('select principal_returned from public.positions where id=$1',[position.id])).rows[0].principal_returned,false);
 });
 await db.close();
});

await test('Terms upgrade preserves existing contracts and customized catalog entries',async()=>{
 const upgrade=new PGlite();
 try{
  await upgrade.exec(bootstrap);
  await upgrade.exec(migration);await upgrade.exec(catalog);
  await upgrade.exec("update public.products set daily_bps=725,duration_days=18 where name='Drone inteligente';update public.products set category='distribution' where name='Moto elétrica';");
  await upgrade.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3::jsonb)',[ids.root,'existing@example.test',JSON.stringify({full_name:'Usuário existente',whatsapp:'21999999999'})]);
  await upgrade.query("insert into public.positions(user_id,payer_id,product_id,name,category,image,principal_cents,daily_bps,duration_days,return_principal) select $1,$1,id,name,category,image,price_cents,100,30,false from public.products where name='Patinete urbano'",[ids.root]);
  await upgrade.exec(terms);await upgrade.exec(security);await upgrade.exec(launch);
  const contract=(await upgrade.query('select * from public.positions')).rows[0];
  assert.equal(contract.return_principal,false);assert.equal(contract.daily_bps,100);assert.equal(contract.duration_days,30);assert.equal(contract.principal_returned,false);
  const custom=(await upgrade.query("select * from public.products where name='Drone inteligente'")).rows[0];
  assert.equal(custom.daily_bps,725);assert.equal(custom.duration_days,18);
  const changedCategory=(await upgrade.query("select * from public.products where name='Moto elétrica'")).rows[0];
  assert.equal(changedCategory.category,'distribution');assert.equal(changedCategory.duration_days,30);assert.equal(changedCategory.daily_bps,0);
  const untouched=(await upgrade.query("select * from public.products where name='Lote de patinetes'")).rows[0];
  assert.equal(untouched.duration_days,15);assert.equal(untouched.daily_bps,500);
  assert.equal((await upgrade.query('select return_principal from public.platform_settings')).rows[0].return_principal,true);
 }finally{await upgrade.close();}
});

await test('Launch upgrade preserves financial history, custom catalog and legacy deposit settlement',async()=>{
 const upgrade=new PGlite();
 try{
  await upgrade.exec(bootstrap);await upgrade.exec(migration);await upgrade.exec(catalog);await upgrade.exec(terms);await upgrade.exec(security);
  let previous=null;
  for(const [name,id] of Object.entries(ids)){
   const referral=previous?(await upgrade.query('select referral_code from public.profiles where id=$1',[previous])).rows[0].referral_code:'';
   await upgrade.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3::jsonb)',[id,`${name}@example.test`,JSON.stringify({full_name:`Existing ${name}`,whatsapp:'21999999999',referral_code:referral})]);
   previous=id;
  }
  await upgrade.exec("update public.platform_settings set commission_bps='{1500,300,100}',withdrawals_enabled=true;update public.wallets set available_cents=100000;");
  const product=(await upgrade.query("update public.products set active=true,price_cents=10000,daily_bps=725,duration_days=18 where name='Drone inteligente' returning id")).rows[0].id;
  await upgrade.query("select set_config('request.jwt.claim.sub',$1,false)",[ids.grand]);
  const purchase={request_id:req(),product_id:product,quantity:2};
  const invoke=async data=>(await upgrade.query("select public.app_action('purchase',$1::jsonb) result",[JSON.stringify(data)])).rows[0].result;
  const originalResult=await invoke(purchase);
  const legacy=[];
  for(const status of ['pending','creating','pending']){
   const id=req();legacy.push(id);
   await upgrade.query('insert into public.deposits(id,user_id,amount_cents,provider_id,status) values($1,$2,1000,$3,$4)',[id,ids.grand,`legacy-${id}`,status]);
  }
  await upgrade.query('select public.settle_deposit($1,$2,1000,$3,10)',[legacy[2],`legacy-${legacy[2]}`,'completed']);
  const history=async()=>{
   const result={};
   for(const table of ['wallets','commissions','ledger','positions','deposits','profiles','products','app_requests']) result[table]=(await upgrade.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) data from public.${table} t`)).rows[0].data;
   return result;
  };
  const before=await history();
  assert.deepEqual(before.commissions.map(c=>Number(c.amount_cents)).sort((a,b)=>a-b),[100,300,1500]);
  const routine=async()=> (await upgrade.query("select prosrc,proacl,prosecdef,proconfig from pg_proc where oid='public.app_action_internal(text,jsonb)'::regprocedure")).rows[0];
  const oldRoutine=await routine();
  await upgrade.exec(launch);
  assert.deepEqual(await history(),before);
  const current=await routine();
  assert.deepEqual(current,{...oldRoutine,prosrc:oldRoutine.prosrc.replace('amt<3500','amt<3000').replace('Saque entre R$35','Saque entre R$30')});
  const settings=(await upgrade.query('select * from public.platform_settings')).rows[0];assert.deepEqual(settings.commission_bps,[1500,500,200]);assert.equal(settings.withdrawals_enabled,true);
  const audit=(await upgrade.query("select details from public.admin_audit where action='launch_rules'")).rows[0].details;
  assert.deepEqual(audit.previous_commission_bps,[1500,300,100]);assert.deepEqual(audit.commission_bps,[1500,500,200]);
  assert.deepEqual(await invoke(purchase),originalResult);assert.deepEqual(await history(),before);
  await invoke({...purchase,request_id:req()});
  assert.deepEqual((await history()).commissions,before.commissions);
  const initialBalance=Number((await upgrade.query('select available_cents from public.wallets where user_id=$1',[ids.grand])).rows[0].available_cents);
  for(let i=0;i<2;i++) await upgrade.query('select public.settle_deposit($1,$2,1000,$3,10)',[legacy[0],`legacy-${legacy[0]}`,'completed']);
  assert.equal(Number((await upgrade.query('select available_cents from public.wallets where user_id=$1',[ids.grand])).rows[0].available_cents),initialBalance+1000);
  for(let i=0;i<2;i++) await upgrade.query('select public.settle_deposit($1,$2,1000,$3,10)',[legacy[0],`legacy-${legacy[0]}`,'refunded']);
  await upgrade.query("update public.deposits set status='pending',qr_code='legacy-code' where id=$1",[legacy[1]]);
  await upgrade.query('select public.settle_deposit($1,$2,1000,$3,10)',[legacy[1],`legacy-${legacy[1]}`,'failed']);
  for(let i=0;i<2;i++) await upgrade.query('select public.settle_deposit($1,$2,1000,$3,10)',[legacy[2],`legacy-${legacy[2]}`,'refunded']);
  assert.equal(Number((await upgrade.query('select available_cents from public.wallets where user_id=$1',[ids.grand])).rows[0].available_cents),initialBalance-1000);
  assert.deepEqual((await upgrade.query('select status from public.deposits order by id')).rows.map(d=>d.status),['refunded','failed','refunded']);
  await assert.rejects(upgrade.query('update public.deposits set amount_cents=3499 where id=$1',[legacy[0]]),/Depósito entre R\$35/);
  await assert.rejects(upgrade.query("insert into public.deposits(user_id,amount_cents,status) values($1,1000,'pending')",[ids.grand]),/Depósito entre R\$35/);
  assert.deepEqual((await history()).commissions,before.commissions);
 }finally{await upgrade.close();}
});

await test('Tracked installation records only applied migrations and rejects an existing database',async()=>{
 const {trackedInstallationSql}=await import('../scripts/build-supabase-sql.mjs');
 const sql=await trackedInstallationSql();const fresh=new PGlite();
 try{
  await fresh.exec(bootstrap);await fresh.exec(sql);
  assert.deepEqual((await fresh.query('select version from supabase_migrations.schema_migrations order by version')).rows.map(x=>x.version),['202610060001','202610060002','202610060003','202610060004','202610070001']);
  assert.equal((await fresh.query('select count(*) n from public.products')).rows[0].n,8);
  assert.equal((await fresh.query("select has_schema_privilege('authenticated','supabase_migrations','USAGE') allowed")).rows[0].allowed,false);
  await assert.rejects(fresh.exec(sql),/Instalação automática exige banco novo/);await fresh.exec('rollback;');
  assert.equal((await fresh.query('select count(*) n from supabase_migrations.schema_migrations')).rows[0].n,5);
 }finally{await fresh.close();}
});

await test('Complete SQL installer executes atomically and refuses a second installation',async()=>{
 const {installationSql}=await import('../scripts/build-supabase-sql.mjs');
 const sql=await readFile(new URL('../supabase/INSTALAR_ELETRIFY.sql',import.meta.url),'utf8');
 assert.equal(sql,await installationSql(),'Generate the SQL bundle after editing migrations');
 const fresh=new PGlite();
 try{
  await fresh.exec(bootstrap);await fresh.exec(sql);
  assert.equal((await fresh.query('select count(*) n from public.products')).rows[0].n,8);
  const permissions=(await fresh.query("select relname,relrowsecurity,has_table_privilege('authenticated',oid,'UPDATE') as direct_write from pg_class where relnamespace='public'::regnamespace and relkind='r'")).rows;
  assert.equal(permissions.length,13);assert(permissions.every(p=>p.relrowsecurity&&!p.direct_write));
  await fresh.exec(await readFile(new URL('../supabase/sql/03_verificar_instalacao.sql',import.meta.url),'utf8'));
  await assert.rejects(fresh.exec(sql),/já instalada/);await fresh.exec('rollback');
  assert.equal((await fresh.query('select count(*) n from public.products')).rows[0].n,8);
  const promote=await readFile(new URL('../supabase/sql/01_promover_admin.sql',import.meta.url),'utf8');
  await assert.rejects(fresh.exec(promote),/Substitua admin_uuid/);await fresh.exec('rollback');
  await fresh.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3::jsonb)',[ids.root,'admin@example.test',JSON.stringify({full_name:'Admin real',whatsapp:'21999999999'})]);
  const selected=promote.replace("admin_uuid uuid := '00000000-0000-0000-0000-000000000000'",`admin_uuid uuid := '${ids.root}'`);
  await assert.rejects(fresh.exec(selected),/ainda não confirmado/);await fresh.exec('rollback');
  await fresh.query('update auth.users set email_confirmed_at=now() where id=$1',[ids.root]);await fresh.exec(selected);
  assert.equal((await fresh.query('select is_admin from public.profiles where id=$1',[ids.root])).rows[0].is_admin,true);
  assert.equal((await fresh.query("select count(*) n from public.admin_audit where action='operator_grant_admin'")).rows[0].n,1);
 }finally{await fresh.close();}
});
