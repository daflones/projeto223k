import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {normalizeAnnouncement,announcementContent,announcementKey,validAnnouncementUrl} from '../src/lib/announcements.js';
import {createAnnouncementTracker} from '../src/lib/notices.js';

const directory=new URL('../supabase/migrations/',import.meta.url);
const migration=new URL('202610110001_customizable_dashboard_announcement.sql',directory);
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const group='https://chat.whatsapp.com/EVLODOy777bBwDFkjNQIni';
const bootstrap=`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`;

test('Announcements persist editor content, control visibility and protect publication',async t=>{
 const db=new PGlite();
 try{
  await db.exec(bootstrap);
  for(const name of (await readdir(directory)).filter(n=>/^\d+_.+\.sql$/.test(n)).sort())await db.exec(await readFile(new URL(name,directory),'utf8'));
  for(const n of [1,2])await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[id(n),'notice'+n+'@example.test',JSON.stringify({full_name:'Pessoa '+n,whatsapp:'21999990000'})]);
  await db.query('update public.profiles set is_admin=true where id=$1',[id(1)]);
  const identity=async n=>db.query("select set_config('request.jwt.claim.sub',$1,false)",[n?id(n):'']);
  const get=async()=>(await db.query('select public.announcement_admin_get() value')).rows[0].value;
  const current=async()=>(await db.query('select public.announcement_current() value')).rows[0].value;
  const save=async(data,revision,republish=false)=>(await db.query('select public.announcement_admin_save($1,$2,$3) value',[JSON.stringify(data),revision,republish])).rows[0].value;
  const financial=async()=>{
   const result={};for(const table of ['wallets','ledger','positions','commissions','deposits','withdrawals','coupon_redemptions'])result[table]=(await db.query(`select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) value from public.${table} r`)).rows[0].value;
   result.settings=(await db.query("select to_jsonb(s)-'whatsapp_group' value from public.platform_settings s")).rows[0].value;
   return result;
  };
  await identity(1);const before=await financial();
  await db.exec('set role authenticated');
  let notice=await get();
  await t.test('Installation updates both the popup link and floating WhatsApp group',async()=>{
   assert.equal(notice.whatsapp_group,group);assert.equal(notice.buttons[0].url,group);assert.equal(notice.revision,1);
   await identity(2);const visible=await current();assert.equal(visible.buttons[0].url,group);assert.equal(visible.updated_by,undefined);
   await identity(1);
  });
  await t.test('Title, multiline message, optional image, ordered buttons and display settings persist',async()=>{
   notice=await save({...notice,title:'Comunicado <Eletrify>',message:'Primeira linha\n\nSegunda linha',image_url:'/assets/logo.png',image_alt:'Marca Eletrify',buttons:[{label:'Abrir grupo',url:group,style:'primary'},{label:'Suporte',url:'https://wa.me/5521999990000',style:'secondary'}]},notice.revision);
   assert.equal(notice.revision,2);assert.equal(notice.message,'Primeira linha\n\nSegunda linha');assert.equal(notice.image_url,'/assets/logo.png');assert.deepEqual(notice.buttons.map(b=>b.label),['Abrir grupo','Suporte']);
   assert.equal((await current()).title,'Comunicado <Eletrify>');
   const identical=await save(notice,2);assert.equal(identical.revision,2,'Saving unchanged content does not reopen the popup');
   await assert.rejects(save({...notice,title:'Edição antiga'},1),/alterado por outro administrador/);
   assert.equal((await get()).title,notice.title);
   notice=await save(notice,2,true);assert.equal(notice.revision,3,'Republish reopens the same content');
  });
  await t.test('Inactive announcements disappear; removing image/buttons and card-only mode works',async()=>{
   notice=await save({...notice,active:false},notice.revision);assert.equal(await current(),null);assert.equal((await get()).active,false);
   notice=await save({...notice,active:true,image_url:null,image_alt:'',buttons:[],show_popup:false,show_card:true},notice.revision);
   assert.deepEqual((await current()).buttons,[]);assert.equal((await current()).image_url,null);assert.equal((await current()).show_popup,false);
  });
  await t.test('Invalid URLs, field types and excess buttons reject without overwriting content',async()=>{
   for(const url of ['javascript:alert(1)','http://example.test','https://user:pass@example.test','https://example.test/" onerror="alert(1)','https://example.test/\\file'])await assert.rejects(save({...notice,buttons:[{label:'Abrir',url,style:'primary'}]},notice.revision));
   for(const image_url of ['data:image/svg+xml,<svg/>','/assets/../secret','javascript:alert(1)'])await assert.rejects(save({...notice,image_url},notice.revision));
   for(const change of [{buttons:Array(6).fill({label:'Abrir',url:group,style:'primary'})},{title:''},{title:12},{message:'a'.repeat(4001)},{active:'true'},{buttons:{}},{whatsapp_group:'https://example.test'}])await assert.rejects(save({...notice,...change},notice.revision));
   assert.deepEqual(await get(),notice);
  });
  await t.test('Normal, anonymous, blocked and revoked users cannot manage announcements',async()=>{
   await identity(2);assert(await current());await assert.rejects(get(),/administrativo negado/);await assert.rejects(save({...notice,is_admin:true},notice.revision),/administrativo negado/);await assert.rejects(db.query('select * from public.platform_announcements'),/permission denied/);
   await db.exec('reset role;set role anon');await assert.rejects(current(),/permission denied/);await assert.rejects(get(),/permission denied/);await db.exec('reset role');
   await identity(null);await db.exec('set role authenticated');await assert.rejects(current(),/Acesso negado/);await db.exec('reset role');
   await db.query('update public.profiles set blocked=true where id=$1',[id(1)]);await identity(1);await db.exec('set role authenticated');await assert.rejects(current(),/Acesso negado/);await assert.rejects(get(),/administrativo negado/);await db.exec('reset role');
   await db.query('update public.profiles set blocked=false,is_admin=false where id=$1',[id(1)]);await db.exec('set role authenticated');await assert.rejects(save(notice,notice.revision),/administrativo negado/);await db.exec('reset role');
   await db.query('update public.profiles set is_admin=true where id=$1',[id(1)]);
  });
  await t.test('Reapplying the upgrade preserves published edits and financial state',async()=>{
   const latest=await get();await db.exec(await readFile(migration,'utf8'));assert.deepEqual(await get(),latest);assert.deepEqual(await financial(),before);
  });
 }finally{await db.close();}
});

test('Each announcement revision is acknowledged separately without rendering unsafe HTML or links',()=>{
 const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)},tracker=createAnnouncementTracker(()=>storage);
 const first={id:'dashboard',revision:1,title:'<img src=x onerror=alert(1)>',message:'<script>alert(1)</script>\nLinha 2',image_url:null,image_alt:'',buttons:[{label:'<b>Grupo</b>',url:group,style:'primary'}],active:true,show_popup:true,show_card:true};
 assert(normalizeAnnouncement(first));const html=announcementContent(first);assert(!html.includes('<script>'));assert(!html.includes('<b>'));assert(html.includes('&lt;script&gt;'));assert(html.includes('rel="noopener noreferrer"'));
 tracker.acknowledge('user-a',announcementKey(first));assert.equal(tracker.shouldShow('user-a',announcementKey(first)),false);
 assert.equal(tracker.shouldShow('user-a',announcementKey({...first,revision:2})),true);assert.equal(tracker.shouldShow('user-b',announcementKey(first)),true);
 for(const bad of ['javascript:alert(1)','http://example.test','https://user:pass@example.test','//example.test','/assets/../secret'])assert.equal(validAnnouncementUrl(bad),false);
 assert.equal(validAnnouncementUrl('/assets/logo.png',true),true);
 assert.equal(normalizeAnnouncement({...first,buttons:[{label:'Abrir',url:'javascript:alert(1)',style:'primary'}]}),null);
});
