// Real PostgreSQL routines in an isolated PGlite database. 15/3/1 is a test
// configuration, not a decision about Eletrify's unconfirmed launch rates.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const migrations=await Promise.all(['202610060001_platform.sql','202610060002_catalog.sql','202610060003_investment_terms.sql','202610060004_admin_and_webhook_queue.sql','202610070001_launch_rules.sql'].map(name=>readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8')));
const ids=Object.fromEntries(['A','B','C','D','E'].map((name,i)=>[name,`00000000-0000-4000-8000-${String(i+101).padStart(12,'0')}`]));
async function fixture(run){
 const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
   create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb);
   create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
  for(const migration of migrations) await db.exec(migration);
  for(const [i,name] of ['A','B','C','D','E'].entries()){
   const previous=i>0&&name!=='E'?ids[['A','B','C','D'][i-1]]:null;
   const ref=previous?(await db.query('select referral_code from public.profiles where id=$1',[previous])).rows[0].referral_code:'';
   await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3::jsonb)',
    [ids[name],`${name}@example.test`,JSON.stringify({full_name:`Pessoa ${name}`,whatsapp:'21999999999',referral_code:ref})]);
  }
  assert.deepEqual((await db.query('select commission_bps from public.platform_settings')).rows[0].commission_bps,[1500,500,200]);
  await db.exec('update public.wallets set available_cents=1000000;');
  const product=(await db.query("insert into public.products(name,category,image,price_cents,daily_bps,duration_days,active) values('Comissões teste','production','/assets/test.png',10000,500,10,true) returning id")).rows[0].id;
  const act=async(name,action='purchase',data={})=>{
   await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[name]]);
   return (await db.query('select public.app_action($1,$2::jsonb) result',[action,JSON.stringify({request_id:randomUUID(),product_id:product,quantity:1,...data})])).rows[0].result;
  };
  const commissions=async()=> (await db.query('select * from public.commissions')).rows;
  const marker=async name=>(await db.query('select first_purchase_at from public.profiles where id=$1',[ids[name]])).rows[0].first_purchase_at;
  const balance=async name=>Number((await db.query('select available_cents from public.wallets where user_id=$1',[ids[name]])).rows[0].available_cents);
  await run({db,product,act,commissions,marker,balance});
 }finally{await db.close();}
}

test('First product pays three ancestors once, even for a multiple-unit purchase',async()=>fixture(async({db,act,commissions,marker,balance})=>{
 const rid=randomUUID();await act('D','purchase',{quantity:3,request_id:rid});
 const rows=await commissions();assert.equal(rows.length,3);
 for(const [name,level,cents] of [['C',1,1500],['B',2,500],['A',3,200]]){
  const row=rows.find(c=>c.user_id===ids[name]);assert.equal(row.level,level);assert.equal(Number(row.amount_cents),cents);assert.equal(row.source_user_id,ids.D);
  assert.equal(await balance(name),1000000+cents);
 }
 assert(await marker('D'));assert.equal(await balance('D'),970000);
 assert.equal((await db.query('select count(*) n from public.positions where user_id=$1',[ids.D])).rows[0].n,3);
 // Ancestors do not need their own product under the current implementation.
 assert.equal((await db.query('select count(*) n from public.positions where user_id<>$1',[ids.D])).rows[0].n,0);
 await act('D','purchase',{quantity:3,request_id:rid});assert.equal(await balance('D'),970000);
 await act('D');assert.equal((await commissions()).length,3);assert.equal(await balance('D'),960000);
}));

test('A buyer consuming its commission event does not stop descendant commissions',async()=>fixture(async({act,commissions})=>{
 await act('B');await act('B');await act('C');await act('D');await act('D');
 const rows=await commissions();
 const root=rows.filter(c=>c.user_id===ids.A).sort((a,b)=>a.level-b.level);
 assert.deepEqual(root.map(c=>c.level),[1,2,3]);
 assert.deepEqual(root.map(c=>Number(c.amount_cents)),[1500,500,200]);
 assert.equal(rows.length,6); // Each source's first purchase, no second-purchase bonus.
}));

test('Gifts and admin grants do not pay or consume the recipient first-purchase event',async()=>fixture(async({db,product,act,commissions,marker})=>{
 await act('A','gift',{user_id:ids.D,quantity:2});
 await db.query('update public.profiles set is_admin=true where id=$1',[ids.A]);
 await act('A','admin_position',{user_id:ids.D,product_id:product,reason:'Concessão em teste isolado'});
 assert.equal((await commissions()).length,0);assert.equal(await marker('A'),null);assert.equal(await marker('D'),null);
 await act('D');assert.equal((await commissions()).length,3);assert(await marker('D'));
}));

test('Failed purchase rolls back positions, commission marker and ledger credits',async()=>fixture(async({db,act,commissions,marker})=>{
 await db.query('update public.wallets set available_cents=0 where user_id=$1',[ids.D]);
 await assert.rejects(act('D'),/wallets_available_cents_check/);
 assert.equal(await marker('D'),null);assert.equal((await commissions()).length,0);
 assert.equal((await db.query('select count(*) n from public.positions')).rows[0].n,0);
 assert.equal((await db.query('select count(*) n from public.ledger')).rows[0].n,0);
 await db.query('update public.wallets set available_cents=10000 where user_id=$1',[ids.D]);
 await act('D');assert.equal((await commissions()).length,3);
}));

test('Zero-rate levels do not receive retroactive credit after their source buys again',async()=>fixture(async({db,act,commissions,marker})=>{
 await db.exec("update public.platform_settings set commission_bps='{1500,0,0}'");
 await act('D');assert(await marker('D'));assert.equal((await commissions()).length,1);
 await db.exec("update public.platform_settings set commission_bps='{1500,500,200}'");
 await act('D');const rows=await commissions();assert.equal(rows.length,1);assert.equal(rows[0].user_id,ids.C);
}));

test('Cent rounding and later price/rate changes preserve commissions already paid',async()=>fixture(async({db,product,act,commissions})=>{
 await db.query('update public.products set price_cents=10001 where id=$1',[product]);
 await act('D');const before=(await commissions()).map(c=>({id:c.id,amount:Number(c.amount_cents)}));
 assert.deepEqual(before.map(c=>c.amount).sort((a,b)=>a-b),[200,500,1500]);
 await db.exec("update public.platform_settings set commission_bps='{2000,500,200}'");
 await db.query('update public.products set price_cents=20000 where id=$1',[product]);
 await act('D');
 const after=(await commissions()).map(c=>({id:c.id,amount:Number(c.amount_cents)}));assert.deepEqual(after,before);
 assert.equal(Number((await db.query('select principal_cents from public.positions where id=$1',[(await commissions())[0].position_id])).rows[0].principal_cents),10001);
}));

test('No sponsor means no commission and client-supplied rates/recipient cannot override the database',async()=>fixture(async({db,act,commissions,marker})=>{
 await act('E');assert.equal((await commissions()).length,0);assert(await marker('E'));
 await act('D','purchase',{user_id:ids.E,referred_by:ids.A,price_cents:1,commission_bps:[9999,0,0]});
 const rows=await commissions();assert.equal(rows.length,3);assert.equal(Number(rows.find(c=>c.user_id===ids.C).amount_cents),1500);
 assert((await db.query('select user_id from public.positions where payer_id=$1',[ids.D])).rows.every(p=>p.user_id===ids.D));
}));
