import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const directory=new URL('../supabase/migrations/',import.meta.url);
const bootstrap=`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`;
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

test('Admin pages cover full histories and detailed referral profiles without financial writes',async t=>{
 const db=new PGlite();
 try{
  await db.exec(bootstrap);
  for(const name of (await readdir(directory)).filter(name=>/^\d+_.+\.sql$/.test(name)).sort())await db.exec(await readFile(new URL(name,directory),'utf8'));
  async function signup(n,name,parent){
   const reference=parent?(await db.query('select referral_code from public.profiles where id=$1',[id(parent)])).rows[0].referral_code:'';
   await db.query('insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,$2,now(),$3::jsonb)',[id(n),`member-${n}@example.test`,JSON.stringify({full_name:name,whatsapp:'2199999'+String(n).padStart(4,'0'),referral_code:reference})]);
  }
  await signup(1,'Operador');await signup(2,'Líder');await signup(3,'Nível Um',2);await signup(4,'Nível Dois',3);await signup(5,'Nível Três',4);await signup(6,'Nível Quatro',5);
  for(let n=7;n<=57;n++)await signup(n,n===57?'Busca_% Pessoa':`Usuário ${String(n).padStart(3,'0')}`);
  await db.query('update public.profiles set is_admin=true where id=$1',[id(1)]);
  const identity=async n=>db.query("select set_config('request.jwt.claim.sub',$1,false)",[n?id(n):'']);
  let request=1000;
  const action=async(name,data)=>(await db.query('select public.app_action($1,$2::jsonb) result',[name,JSON.stringify({request_id:id(request++),...data})])).rows[0].result;
  await identity(1);
  const product=(await action('admin_product',{name:'Produto de referência',category:'production',image:'/assets/test.png',price_cents:10000,daily_bps:500,duration_days:10,active:true})).id;
  for(const buyer of [2,3,4,5]){
   await identity(1);await action('admin_balance',{user_id:id(buyer),amount_cents:20000,reason:'Preparação do teste'});
   await identity(buyer);await action('purchase',{product_id:product,quantity:1});
  }
  await identity(1);
  await db.query(`insert into public.positions(user_id,payer_id,product_id,name,category,image,principal_cents,daily_bps,duration_days)
   select $1,$2,$3,'Concessão '||n,'production','/assets/test.png',1000,500,10 from generate_series(1,26) n`,[id(3),id(1),product]);
  await db.query(`insert into public.withdrawals(user_id,amount_cents,fee_cents,payout_cents,pix_key,pix_key_type,recipient_document,day_key,created_at)
   select $1,3500,175,3325,'21999990000','phone','12345678901',date '2020-01-01'+n,timestamp with time zone '2020-01-01'+n*interval '1 day' from generate_series(1,1107) n`,[id(2)]);
  await db.query(`insert into public.deposits(user_id,amount_cents,status,created_at) select $1,3500,'completed',timestamp with time zone '2020-01-01'+n*interval '1 day' from generate_series(1,605) n`,[id(2)]);
  await db.query(`insert into public.coupons(creator_id,code,max_total,max_per_user,max_selections) select $1,'ADMIN-'||lpad(n::text,6,'0'),50,1,1 from generate_series(1,27) n`,[id(1)]);
  await db.exec(`insert into public.coupon_options(coupon_id,kind,amount_cents) select id,'balance',500 from public.coupons;
   insert into public.admin_audit(admin_id,action,details) select null,'page-fixture-'||n,'{}' from generate_series(1,135) n;
   insert into public.webhook_inbox(delivery_id,event,payload) select 'test-delivery-'||n,'pix.received','{}' from generate_series(1,127) n;`);
  const page=async(section,{number=1,size=20,search='',status='',user=null,level=1}={})=>(await db.query('select public.admin_page($1,$2,$3,$4,$5,$6,$7) result',[section,number,size,search,status,user,level])).rows[0].result;
  const profile=async user=>(await db.query('select public.admin_user_profile($1) result',[user])).rows[0].result;
  const financial=async()=>{
   const result={};for(const table of ['wallets','ledger','positions','commissions','deposits','withdrawals','coupon_redemptions'])result[table]=(await db.query(`select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) data from public.${table} r`)).rows[0].data;
   return result;
  };
  const before=await financial();
  await db.exec('set role authenticated');
  await t.test('Every admin list is bounded, complete, searchable and has stable page order',async()=>{
   const expectations={users:57,positions:30,withdrawals:1107,deposits:605,coupons:27,webhooks:127};
   for(const section of ['users','products','positions','withdrawals','deposits','coupons','audit','webhooks','commissions']){
    const first=await page(section),last=await page(section,{number:999999});
    if(expectations[section])assert.equal(first.total,expectations[section],section);
    assert(first.items.length<=20);assert.equal(last.page,last.total_pages);
    assert.deepEqual(await page(section),first,'Stable ordering for '+section);
    if(first.total_pages>1){const second=await page(section,{number:2});const keys=first.items.map(x=>x.id||x.delivery_id);assert(second.items.every(x=>!keys.includes(x.id||x.delivery_id)),section+' repeats rows');}
   }
   const first=await page('users',{size:1000,number:-10});assert.equal(first.page_size,100);assert.equal(first.page,1);
   const literal=await page('users',{search:'_%'});assert.equal(literal.total,1);assert.equal(literal.items[0].full_name,'Busca_% Pessoa');
   assert.equal((await page('users',{search:"' OR true --"})).total,0);
   const empty=await page('users',{search:'nobody-matches',number:5});assert.equal(empty.page,1);assert.equal(empty.total,0);assert.deepEqual(empty.items,[]);
   await assert.rejects(page('users; drop table profiles'),/Lista administrativa inválida/);
  });
  await t.test('Profile and three affiliate levels report actual received commissions and all products',async()=>{
   const d=await profile(id(2));assert.equal(d.user.whatsapp,'21999990002');assert.equal(d.user.email,'member-2@example.test');
   assert.equal(d.commissions_cents,2200);assert.equal(d.products_count,1);
   assert.deepEqual(d.levels.map(x=>[x.level,x.total,x.commissions_cents]),[[1,1,1500],[2,1,500],[3,1,200]]);
   for(const level of [1,2,3]){
    const rows=await page('affiliates',{user:id(2),level});assert.equal(rows.total,1);assert.equal(rows.items[0].id,id(level+2));assert(rows.items[0].whatsapp);
    assert.equal(rows.items[0].commission_cents,[1500,500,200][level-1]);
   }
   const first=(await page('affiliates',{user:id(2),level:1})).items[0];assert.equal(first.products_count,27);assert.equal(first.products.length,3);
   const products=await page('positions',{user:id(3),number:2});assert.equal(products.total,27);assert.equal(products.items.length,7);assert(products.items.every(p=>p.user_id===id(3)));
   const commissions=await page('commissions',{user:id(2),status:'2'});assert.equal(commissions.total,1);assert.equal(commissions.items[0].source_name,'Nível Dois');assert.equal(commissions.items[0].product_name,'Produto de referência');
   await assert.rejects(page('affiliates',{user:id(2),level:4}),/Nível inválido/);
  });
  await t.test('Overview counts all records, independently of the displayed page',async()=>{
   const overview=(await db.query('select public.admin_overview() result')).rows[0].result;
   assert.equal(overview.users_count,57);assert.equal(overview.pending_withdrawals,1107);assert.equal(overview.pending_withdrawal_cents,1107*3500);assert.equal(overview.completed_deposits,605);
  });
  await db.exec('reset role');assert.deepEqual(await financial(),before);
  await t.test('Anonymous, ordinary, blocked and revoked administrators cannot read private projections',async()=>{
   await db.exec('set role anon');await assert.rejects(page('users'),/permission denied/);await assert.rejects(profile(id(2)),/permission denied/);await db.exec('reset role');
   for(const who of [2,null]){await identity(who);await db.exec('set role authenticated');await assert.rejects(page('users'),/Acesso administrativo negado/);await assert.rejects(profile(id(2)),/Acesso administrativo negado/);await assert.rejects(db.query('select public.admin_overview()'),/Acesso administrativo negado/);await assert.rejects(db.query('select * from public.profiles'),/permission denied/);await db.exec('reset role');}
   await identity(1);
   for(const change of ['blocked=true','blocked=false,is_admin=false']){
    await db.query('update public.profiles set '+change+' where id=$1',[id(1)]);await db.exec('set role authenticated');await assert.rejects(page('users'),/Acesso administrativo negado/);await assert.rejects(profile(id(2)),/Acesso administrativo negado/);await db.exec('reset role');
   }
  });
 }finally{await db.close();}
});
