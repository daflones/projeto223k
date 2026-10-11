// Run DOM flows without a browser. Supplement with mobile/desktop browser QA at deploy.
import {Window} from 'happy-dom';import {readFile} from 'node:fs/promises';import {setTimeout as nativeTimeout} from 'node:timers';import {webcrypto} from 'node:crypto';
import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
const w=new Window({url:'https://preview.example.test'});globalThis.window=w;globalThis.document=w.document;globalThis.location=w.location;globalThis.history=w.history;globalThis.localStorage=w.localStorage;globalThis.FormData=w.FormData;Object.defineProperty(globalThis,'navigator',{value:w.navigator,configurable:true});globalThis.crypto??=webcrypto;
w.scrollTo=()=>{};globalThis.setInterval=()=>0;globalThis.setTimeout=(fn)=>0;
const proto=w.HTMLDialogElement.prototype;proto.showModal=function(){this.open=true;this.setAttribute('open','');};proto.close=function(){this.open=false;this.removeAttribute('open');};
w.document.body.innerHTML='<div id="app"></div>';
let main=await readFile(new URL('../src/main.js',import.meta.url),'utf8');main=main.replace("import './style.css';",'').replaceAll('import.meta.env.DEV','true').replace("from './lib/store.js';","from './smoke-store.mjs';");
// store relies on Vite import.meta.env. Use its source transformed solely for this test.
let st=await readFile(new URL('../src/lib/store.js',import.meta.url),'utf8');st=st.replaceAll('import.meta.env.VITE_SUPABASE_URL','undefined').replaceAll('import.meta.env.VITE_SUPABASE_ANON_KEY','undefined').replaceAll('import.meta.env.DEV','true').replace("'../../supabase/","'./supabase/").replace("'./demo.js'","'./src/lib/demo.js'");
const base=process.cwd();const {writeFile,unlink}=await import('node:fs/promises');await writeFile(base+'/smoke-store.mjs',st);main=main.replace("'./src/lib/store.js'","'./smoke-store.mjs'").replace("'./lib/notices.js'","'./src/lib/notices.js'").replace("'./lib/admin-ui.js'","'./src/lib/admin-ui.js'").replace("'./lib/announcements.js'","'./src/lib/announcements.js'");await writeFile(base+'/smoke-main.mjs',main);
try{
 await import(pathToFileURL(base+'/smoke-main.mjs').href);w.document.querySelector('#demo-button').click();
 const tick=()=>new Promise(resolve=>nativeTimeout(resolve,20));
 for(let i=0;i<100&&!w.document.querySelector('.shell');i++)await tick();
 if(!w.document.querySelector('.shell'))throw new Error('Demo mode did not load');
 assert(w.document.querySelector('#modal').open,'Community notice opens on the first dashboard');
 assert.equal(w.document.querySelector('.community-join').href,'https://chat.whatsapp.com/EVLODOy777bBwDFkjNQIni');
 assert(w.document.querySelector('#community-notice-message').textContent.includes('será desativado'));
 w.document.querySelector('#modal [data-action=close]').click();
 assert(!w.document.querySelector('#modal').open);

 for(const route of ['products','positions','team','wallet','admin','dashboard']){w.document.querySelector(`[data-action=navigate][data-route=${route}]`).click();await tick();if(!w.document.querySelector('.page h1'))throw new Error('Missing route '+route);}
 assert(!w.document.querySelector('#modal').open,'Acknowledged notice does not reopen on dashboard navigation');
 for(const act of ['deposit','withdraw','profile','whatsapp']){w.document.querySelector(`[data-action=${act}]`).click();await tick();if(!w.document.querySelector('#modal').open)throw new Error('Modal failed '+act);w.document.querySelector('#modal').close();}
 w.document.querySelector('[data-action=navigate][data-route=admin]').click();await tick();
 for(const tab of ['products','users','positions','withdrawals','deposits','coupons','announcements','settings','audit','overview']){w.document.querySelector(`[data-action=admin-tab][data-tab=${tab}]`).click();await tick();if(!w.document.querySelector('.admin-tabs'))throw new Error('Admin tab failed');}

 // Confirm purchases, deposit simulation and withdrawal approval flows in the actual UI.
 const click=async sel=>{const el=w.document.querySelector(sel);if(!el)throw new Error('Missing control '+sel);el.click();await tick();};
 const submit=async()=>{w.document.querySelector('#modal form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();await tick();};
 await click('[data-action=navigate][data-route=products]');await click('[data-action=product]');w.document.querySelector('[name=quantity]').value='2';w.document.querySelector('#modal [type=checkbox]').checked=true;await submit();
 if(w.document.querySelector('#modal').open)throw new Error('Purchase form did not complete');
 const store=await import(pathToFileURL(base+'/smoke-store.mjs').href);
 assert.deepEqual((await store.snapshot(true)).settings.commission_bps,[1500,500,200]);
 for(const amount_cents of [3499,500001,3500.5,NaN])await assert.rejects(store.payment('create_deposit',{amount_cents}),/Depósito entre R\$35 e R\$5\.000/);
 for(const amount_cents of [2999,1000001,3000.5,NaN])await assert.rejects(store.action('withdrawal',{amount_cents}),/Saque entre R\$30 e R\$10\.000/);
 assert.equal((await store.snapshot(true)).deposits.length,0);assert.equal((await store.snapshot(true)).withdrawals.length,0);
 await click('[data-action=navigate][data-route=wallet]');
 assert(w.document.querySelector('.wallet-rules').textContent.includes('R$35 a R$5.000'));assert(w.document.querySelector('.wallet-rules').textContent.includes('R$30 a R$10.000'));
 assert.equal(w.document.querySelector('.wallet-rules .status'),null);assert(!w.document.querySelector('.wallet-rules').textContent.includes('aprovação administrativa'));
 await click('[data-action=deposit]');assert.equal(w.document.querySelector('[name=amount]').min,'35');assert.equal(w.document.querySelector('[name=amount]').max,'5000');
 for(const amount of ['34.99','5000.01']){w.document.querySelector('[name=amount]').value=amount;await submit();assert(w.document.querySelector('#modal').open);assert.match(w.document.querySelector('.form-error').textContent,/Depósito entre R\$35 e R\$5\.000/);assert.equal((await store.snapshot(true)).deposits.length,0);}
 w.document.querySelector('[name=amount]').value='35';await submit();assert.equal((await store.snapshot(true)).deposits[0].amount_cents,3500);await click('[data-action=check-deposit]');
 await click('[data-action=withdraw]');assert.equal(w.document.querySelector('[name=amount]').min,'30');assert.equal(w.document.querySelector('[name=amount]').max,'10000');w.document.querySelector('[name=pix_key]').value='12345678901';w.document.querySelector('[name=recipient_document]').value='12345678901';
 for(const amount of ['29.99','10000.01']){w.document.querySelector('[name=amount]').value=amount;await submit();assert(w.document.querySelector('#modal').open);assert.match(w.document.querySelector('.form-error').textContent,/Saque entre R\$30 e R\$10\.000/);assert.equal((await store.snapshot(true)).withdrawals.length,0);}
 w.document.querySelector('[name=amount]').value='30';await submit();
 const requested=(await store.snapshot(true)).withdrawals[0];assert.equal(requested.amount_cents,3000);assert.equal(requested.fee_cents,150);assert.equal(requested.payout_cents,2850);
 await click('[data-action=navigate][data-route=admin]');await click('[data-action=admin-tab][data-tab=withdrawals]');await click('[data-action=approve]');await submit();await click('[data-action=process]');
 if(!w.document.querySelector('.status.completed'))throw new Error('Approved withdrawal did not complete');
 // New-product defaults follow the category and preserve manually entered terms.
 await click('[data-action=admin-tab][data-tab=products]');await click('.section-heading [data-action=admin-product]');
 assert.equal(w.document.querySelector('[name=rate]').value,'5');assert.equal(w.document.querySelector('[name=duration_days]').value,'10');
 const category=w.document.querySelector('[name=category]'),duration=w.document.querySelector('[name=duration_days]');
 category.value='distribution';category.dispatchEvent(new w.Event('change',{bubbles:true}));assert.equal(duration.value,'15');
 duration.value='17';duration.dispatchEvent(new w.Event('input',{bubbles:true}));category.value='production';category.dispatchEvent(new w.Event('change',{bubbles:true}));assert.equal(duration.value,'17');
 w.document.querySelector('[name=name]').value='Produto QA personalizado';w.document.querySelector('[name=price]').value='100';w.document.querySelector('[name=rate]').value='7.5';duration.value='12';w.document.querySelector('[name=active]').checked=true;await submit();
 let state=await store.snapshot(true);
 const custom=state.products.find(p=>p.name==='Produto QA personalizado');assert(custom);assert.equal(custom.duration_days,12);assert.equal(custom.daily_bps,750);
 // Toggling the global policy affects subsequent purchases, keeping earlier contracts.
 await click('[data-action=admin-tab][data-tab=settings]');assert.equal(w.document.querySelector('[name=return_principal]').checked,true);w.document.querySelector('[name=return_principal]').checked=false;
 w.document.querySelector('form[data-form=settings]').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();await tick();
 await click('[data-action=navigate][data-route=products]');await click(`[data-action=product][data-id="${custom.id}"]`);assert(w.document.querySelector('.terms-box').textContent.includes('Não previsto'));w.document.querySelector('#modal [type=checkbox]').checked=true;await submit();
 state=await store.snapshot(true);const noPrincipal=state.positions.find(p=>p.product_id===custom.id);assert.equal(noPrincipal.return_principal,false);assert.equal(state.positions.find(p=>p.id==='position-demo').return_principal,true);
 await click('[data-action=navigate][data-route=admin]');await click('[data-action=admin-tab][data-tab=settings]');w.document.querySelector('[name=return_principal]').checked=true;w.document.querySelector('form[data-form=settings]').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();await tick();
 // Simulate elapsed days in the illustrative store: final yield + principal once.
 state=await store.snapshot(true);const matured=state.positions.find(p=>p.product_id==='prod-0'&&p.id!=='position-demo');assert(matured.return_principal);const before=state.wallet.available_cents;matured.created_at=new Date(Date.now()-10*86400000).toISOString();await store.snapshot(true);
 assert.equal(state.wallet.available_cents-before,10500);assert.equal(matured.earned_cents,3500);assert.equal(matured.principal_returned,true);assert.equal(matured.status,'completed');const after=state.wallet.available_cents;await store.snapshot(true);assert.equal(state.wallet.available_cents,after);
 const beforeNoPrincipal=state.wallet.available_cents;noPrincipal.created_at=new Date(Date.now()-12*86400000).toISOString();await store.snapshot(true);assert.equal(state.wallet.available_cents-beforeNoPrincipal,9000);assert.equal(noPrincipal.principal_returned,false);
 await click('[data-action=navigate][data-route=positions]');await click(`[data-action=position][data-id="${matured.id}"]`);assert(w.document.querySelector('.terms-box').textContent.includes('Concluída'));w.document.querySelector('#modal').close();
 // A gifted product credits its owner at maturity, rather than its purchaser.
 await click('[data-action=navigate][data-route=team]');await click('[data-action=level][data-level="2"]');await click('[data-action=gift][data-id="team-2"]');await click('[data-action=gift-product][data-id="prod-4"]');w.document.querySelector('#modal [type=checkbox]').checked=true;await submit();
 state=await store.snapshot(true);const gift=state.positions.find(p=>p.user_id==='team-2');assert(gift.return_principal);assert.equal(gift.duration_days,15);const buyerBefore=state.wallet.available_cents;gift.created_at=new Date(Date.now()-15*86400000).toISOString();await store.snapshot(true);
 assert.equal(state.team.find(t=>t.id==='team-2').wallet.available_cents,21000);assert.equal(state.wallet.available_cents,buyerBefore);assert.equal(state.team.find(t=>t.id==='team-2').active,false);
 assert.equal(state.ledger.filter(e=>e.kind==='principal_return').length,1);
 // The same signed-in actor loses admin on refresh, including direct navigation.
 await click('[data-action=navigate][data-route=admin]');
 state.profile.is_admin=false;
 await click('[data-action=refresh]');
 assert.equal(w.document.querySelector('[data-route=admin]'),null);
 assert.equal(w.document.querySelector('.admin-tabs'),null);
 assert.equal(w.location.hash,'#/dashboard');
 assert.equal((await store.snapshot(false)).admin,undefined);
 await assert.rejects(store.snapshot(true),/negado/);
 await assert.rejects(store.action('admin_balance',{user_id:state.profile.id,amount_cents:1,is_admin:true}),/negado/);
 await assert.rejects(store.payment('process_approved',{is_admin:true}),/negado/);
 // Force the route through the real navigation handler; it must still redirect.
 const forged=w.document.createElement('button');forged.dataset.action='navigate';forged.dataset.route='admin';
 w.document.querySelector('.page').append(forged);forged.click();await tick();await tick();
 assert.equal(w.location.hash,'#/dashboard');assert.equal(w.document.querySelector('.admin-tabs'),null);
 // Role restoration becomes visible after a normal refresh.
 state.profile.is_admin=true;await click('[data-action=refresh]');
 await click('[data-action=navigate][data-route=admin]');assert(w.document.querySelector('.admin-tabs'));
 await click('[data-action=admin-tab][data-tab=coupons]');await click('[data-action=coupon-create]');
 w.document.querySelector('#modal [name=code]').value='TESTE2026';w.document.querySelector('#modal [name=max_total]').value='2';w.document.querySelector('#modal [name=max_per_user]').value='2';w.document.querySelector('#modal [name=max_selections]').value='2';
 await click('#add-coupon-option');const rows=[...w.document.querySelectorAll('[data-coupon-option]')];rows[0].querySelector('[name=amount]').value='5';rows[1].querySelector('[name=kind]').value='custom';rows[1].querySelector('[name=kind]').dispatchEvent(new w.Event('change',{bubbles:true}));rows[1].querySelector('[name=name]').value='Contrato teste';rows[1].querySelector('[name=price]').value='70';rows[1].querySelector('[name=rate]').value='5';rows[1].querySelector('[name=duration_days]').value='10';
 await submit();assert(w.document.querySelector('.admin-tabs').textContent.includes('Cupons'));assert(w.document.querySelector('.page').textContent.includes('TESTE2026'));
 await click('[data-action=navigate][data-route=dashboard]');await click('[data-action=coupon]');w.document.querySelector('#modal [name=code]').value='TESTE2026';await submit();assert(w.document.querySelector('#modal').textContent.includes('Contrato teste'),w.document.querySelector('#modal').textContent);w.document.querySelectorAll('#modal [name=reward]').forEach(x=>x.checked=true);await submit();
 assert(w.document.querySelector('#modal').textContent.includes('Cupom resgatado'));assert.equal((await store.snapshot(true)).couponRedemptions.length,1);
 await click('#modal [data-action=close]');await click('[data-action=navigate][data-route=admin]');await click('[data-action=admin-tab][data-tab=overview]');
 const metrics=[...w.document.querySelectorAll('.admin-metrics .metric')];assert.equal(metrics.length,4);
 assert.equal(metrics[1].querySelector('span').textContent,'Produtos ativos · compras próprias');assert.equal(metrics[2].querySelector('span').textContent,'Produtos ativos · cupons');
 assert.equal(Number(metrics[2].querySelector('strong').textContent),1);
 // Advertise the real welcome coupon only for accounts that have never redeemed it.
 await click('[data-action=navigate][data-route=admin]');
 await store.couponAdminSave({code:'ELETRIFY',max_total:3,max_per_user:2,max_selections:1,options:[{kind:'balance',amount_cents:500},{kind:'custom',name:'Presente Eletrify',category:'production',image:'/assets/patinete-bateria-componentes.png',price_cents:1000,daily_bps:500,duration_days:10,return_principal:true}]});
 await click('[data-action=navigate][data-route=dashboard]');
 assert(w.document.querySelector('.welcome-card'));
 assert(w.document.querySelector('.welcome-card').textContent.includes('5% ao dia por 10 dias'));
 await click('.welcome-card [data-action=welcome-coupon]');
 assert.equal(w.document.querySelector('#modal form').dataset.code,'ELETRIFY');
 assert.equal(w.document.querySelectorAll('#modal [name=reward]').length,2);
 w.document.querySelector('#modal [name=reward]').checked=true;await submit();
 assert(w.document.querySelector('#modal').textContent.includes('Cupom resgatado'));
 assert.equal(w.document.querySelector('.welcome-card'),null,'Welcome banner disappears after confirmed redemption');
 await click('#modal [data-action=close]');await click('[data-action=refresh]');
 assert.equal(w.document.querySelector('.welcome-card'),null,'Already redeemed remains hidden after another server read');
 assert(w.document.querySelector('.community-card a').href.endsWith('EVLODOy777bBwDFkjNQIni'));
 // Admin pages work with histories larger than one screen, while user details
 // still expose independent affiliate levels, complete products and paid commissions.
 state=await store.snapshot(true);
 state.profile.whatsapp='(21) 99999-0000';state.profile.email='admin@example.test';
 state.profile.created_at='2026-10-01T12:00:00.000Z';state.profile.email_confirmed_at=state.profile.created_at;
 const now=new Date().toISOString();
 for(let i=0;i<31;i++)state.team.push({id:'qa-user-'+i,full_name:'Usuário QA '+String(i).padStart(2,'0'),email:'qa'+i+'@example.test',whatsapp:'2199999'+String(i).padStart(4,'0'),referred_by:state.profile.id,level:1,created_at:now,products:[],wallet:{available_cents:0,reserved_cents:0}});
 Object.assign(state.team.find(t=>t.id==='team-1'),{whatsapp:'21999991111',email:'camila@example.test',referred_by:state.profile.id});
 Object.assign(state.team.find(t=>t.id==='team-2'),{whatsapp:'21999992222',referred_by:'team-1'});
 Object.assign(state.team.find(t=>t.id==='team-3'),{whatsapp:'21999993333',referred_by:'team-2'});
 for(let i=0;i<27;i++)state.positions.push({...state.products[0],id:'qa-position-'+i,product_id:state.products[0].id,user_id:'team-1',payer_id:'team-1',source:'purchase',principal_cents:7000,earned_cents:0,paid_periods:0,return_principal:true,principal_returned:false,status:'active',created_at:now});
 for(let i=0;i<3;i++)state.commissions.push({id:'qa-commission-'+i,user_id:state.profile.id,source_user_id:'team-'+(i+1),position_id:'qa-position-0',level:i+1,amount_cents:[1050,350,140][i],created_at:now});
 for(let i=0;i<26;i++){
  state.products.push({...state.products[0],id:'qa-product-'+i,name:'Catálogo QA '+i,created_at:now});
  state.coupons.push({id:'qa-coupon-'+i,code:'QA-CUPOM-'+String(i).padStart(3,'0'),active:true,max_total:10,max_per_user:1,max_selections:1,options:[],created_at:now});
  state.withdrawals.push({id:'qa-withdrawal-'+i,user_id:state.profile.id,status:'requested',amount_cents:3000,payout_cents:2850,fee_cents:150,pix_key:'12345678901',pix_key_type:'cpf',created_at:now});
  state.deposits.push({id:'qa-deposit-'+i,user_id:state.profile.id,status:'completed',amount_cents:3500,created_at:now});
  state.admin.audit.push({id:'qa-audit-'+i,action:'QA '+i,details:{},created_at:now});
  state.admin.webhooks.push({delivery_id:'qa-event-'+i,event:'pix.received',status:'processed',created_at:now});
 }
 await click('[data-action=navigate][data-route=admin]');
 for(const key of ['products','users','positions','withdrawals','deposits','coupons']){
  await click(`.page [data-action=admin-tab][data-tab=${key}]`);
  assert.equal(w.document.querySelectorAll('.page tbody tr').length,20,key+' is limited to its first 20 records');
  const firstRecord=w.document.querySelector('.page tbody tr').innerHTML;
  await click(`.page [data-action=admin-page][data-key=${key}][data-page="2"]`);
  assert(w.document.querySelector('.page .admin-pagination [role=status]').textContent.includes('Página 2'),key+' next page');
  assert.notEqual(w.document.querySelector('.page tbody tr').innerHTML,firstRecord,key+' second page has different records');
 }
 // Audit records and webhook deliveries paginate separately within the same tab.
 await click('.page [data-action=admin-tab][data-tab=audit]');
 await click('.page [data-action=admin-page][data-key=audit][data-page="2"]');
 assert(w.document.querySelectorAll('.page .admin-pagination [role=status]')[0].textContent.includes('Página 2'));
 assert(w.document.querySelectorAll('.page .admin-pagination [role=status]')[1].textContent.includes('Página 1'));
 await click('.page [data-action=admin-page][data-key=webhooks][data-page="2"]');
 assert(w.document.querySelectorAll('.page .admin-pagination [role=status]')[1].textContent.includes('Página 2'));
 // A page change clears selection; approve-all always includes off-page requests.
 await click('.page [data-action=admin-tab][data-tab=withdrawals]');
 await click('.page [data-action=admin-page][data-key=withdrawals][data-page="1"]');
 w.document.querySelector('.withdraw-select').checked=true;
 await click('.page [data-action=admin-page][data-key=withdrawals][data-page="2"]');
 assert.equal(w.document.querySelectorAll('.withdraw-select:checked').length,0);
 await click('.page [data-action=approve-all]');assert(w.document.querySelector('#modal').textContent.includes('Total pendente: 26'));await click('#modal [data-action=close]');
 // Searching from page two resets to page one; WhatsApp remains visible with email.
 await click('.page [data-action=admin-tab][data-tab=users]');
 let search=w.document.querySelector('form[data-admin-search=users]');search.querySelector('[name=search]').value='Eduardo';search.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();await tick();
 assert.equal(w.document.querySelectorAll('.page tbody tr').length,1);assert(w.document.querySelector('.page .admin-pagination').textContent.includes('Página 1'));
 assert(w.document.querySelector('.page tbody tr').textContent.includes('admin@example.test'));
 assert.equal(w.document.querySelector('.page tbody tr .admin-whatsapp').href,'https://wa.me/5521999990000');
 await click('.page [data-action=admin-user][data-id=demo-user]');
 assert(w.document.querySelector('#modal').classList.contains('admin-user-modal'));assert.equal(w.document.querySelectorAll('.admin-level-card').length,3);
 assert(w.document.querySelector('.admin-profile-metrics').textContent.includes('15,40'));
 await click('#modal [data-action=admin-profile-level][data-level="1"]');
 assert.equal(w.document.querySelectorAll('#modal tbody tr').length,20);
 const size=w.document.querySelector('#modal [data-admin-size]');size.value='50';size.dispatchEvent(new w.Event('change',{bubbles:true}));await tick();await tick();
 assert.equal(w.document.querySelectorAll('#modal tbody tr').length,32);
 assert(w.document.querySelector('#modal tbody').textContent.includes('Camila Santos'));
 await click('#modal [data-action=admin-profile-level][data-level="2"]');assert.equal(w.document.querySelectorAll('#modal tbody tr').length,1);assert(w.document.querySelector('#modal tbody').textContent.includes('Lucas Oliveira'));
 await click('#modal [data-action=admin-profile-level][data-level="3"]');assert.equal(w.document.querySelectorAll('#modal tbody tr').length,1);assert(w.document.querySelector('#modal tbody').textContent.includes('Marina Costa'));
 await click('#modal [data-action=admin-profile-tab][data-tab=commissions]');
 assert.equal(w.document.querySelectorAll('#modal tbody tr').length,3);
 const filter=w.document.querySelector('#modal [data-admin-status]');filter.value='2';filter.dispatchEvent(new w.Event('change',{bubbles:true}));await tick();await tick();
 assert.equal(w.document.querySelectorAll('#modal tbody tr').length,1);assert(w.document.querySelector('#modal tbody').textContent.includes('Lucas Oliveira'));assert(w.document.querySelector('#modal tbody').textContent.includes('3,50'));
 await click('#modal [data-action=admin-profile-tab][data-tab=affiliates]');
 await click('#modal [data-action=admin-profile-level][data-level="1"]');
 await click('#modal [data-action=admin-affiliate-products][data-id=team-1]');
 assert(w.document.querySelector('#modal h2').textContent.includes('Camila Santos'));assert.equal(w.document.querySelectorAll('#modal tbody tr').length,20);
 await click('#modal [data-action=admin-page][data-key=positions][data-page="2"]');assert.equal(w.document.querySelectorAll('#modal tbody tr').length,7);
 await click('#modal [data-action=admin-profile-tab][data-tab=edit]');
 w.document.querySelector('#modal [name=full_name]').value='Camila QA atualizada';w.document.querySelector('#modal [name=whatsapp]').value='21999994444';await submit();
 assert.equal(state.team.find(t=>t.id==='team-1').full_name,'Camila QA atualizada');assert.equal(state.team.find(t=>t.id==='team-1').whatsapp,'21999994444');
 // Existing notices remain untouched after the admin update.
 await click('[data-action=navigate][data-route=dashboard]');assert.equal(w.document.querySelector('.welcome-card'),null);assert(w.document.querySelector('.community-card a').href.endsWith('EVLODOy777bBwDFkjNQIni'));
 // The admin publishes the actual dashboard content rather than a hardcoded UI notice.
 const editNotice=async()=>{await click('[data-action=navigate][data-route=admin]');await click('.page [data-action=admin-tab][data-tab=announcements]');};
 const publishNotice=async()=>{w.document.querySelector('form[data-form=announcement]').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();await tick();};
 await editNotice();
 assert.equal(w.document.querySelector('#announcement-preview a').href,'https://chat.whatsapp.com/EVLODOy777bBwDFkjNQIni');
 let noticeForm=w.document.querySelector('form[data-form=announcement]'),firstRevision=Number(noticeForm.dataset.revision);
 noticeForm.querySelector('[name=title]').value='Atualização <da comunidade>';
 noticeForm.querySelector('[name=message]').value='Comunicado personalizado.\nLinha dois.';
 noticeForm.querySelector('[name=image_url]').value='/assets/logo.png';
 noticeForm.querySelector('[name=image_alt]').value='Logo Eletrify';
 await click('#announcement-add-button');
 let noticeRows=[...w.document.querySelectorAll('[data-announcement-button]')];
 noticeRows[1].querySelector('[name=button_label]').value='Falar com suporte';noticeRows[1].querySelector('[name=button_url]').value='https://wa.me/5521999990000';noticeRows[1].querySelector('[name=button_style]').value='secondary';
 noticeRows[1].querySelector('[data-announcement-move=up]').click();
 noticeForm.dispatchEvent(new w.Event('input',{bubbles:true}));
 assert.equal(w.document.querySelector('#announcement-preview h3').textContent,'Atualização <da comunidade>');assert.equal(w.document.querySelector('#announcement-preview h3 img'),null);
 assert.equal(w.document.querySelector('#announcement-preview a').textContent,'Falar com suporte');
 await publishNotice();
 let published=await store.adminAnnouncementGet();assert.equal(published.revision,firstRevision+1);assert.equal(published.buttons.length,2);assert.equal(published.image_url,'/assets/logo.png');assert.equal(published.buttons[0].style,'secondary');
 await click('[data-action=navigate][data-route=dashboard]');
 assert(w.document.querySelector('#modal').open,'New revision reopens for an account that acknowledged the earlier group');
 assert.equal(w.document.querySelector('#modal h2').textContent,'Atualização <da comunidade>');assert.equal(w.document.querySelector('#modal .announcement-image').getAttribute('src'),'/assets/logo.png');
 assert(w.document.querySelector('#modal .announcement-message').textContent.includes('\nLinha dois.'));
 await click('#modal .community-join');assert(!w.document.querySelector('#modal').open,'Every configured button acknowledges the published revision');
 await click('[data-action=refresh]');assert(!w.document.querySelector('#modal').open);
 await editNotice();
 const {readAnnouncementForm}=await import('../src/lib/announcements.js');
 const reloadedDraft=readAnnouncementForm(w.document.querySelector('form[data-form=announcement]'));
 assert.deepEqual(reloadedDraft,Object.fromEntries(Object.keys(reloadedDraft).map(key=>[key,published[key]])),'Editor preserves stored content when reopened');
 await publishNotice();assert.equal((await store.adminAnnouncementGet()).revision,published.revision,'An unchanged save does not reopen the notice');
 await click('#announcement-republish');assert(w.document.querySelector('#modal').open);await submit();assert.equal((await store.adminAnnouncementGet()).revision,published.revision+1);
 await click('[data-action=navigate][data-route=dashboard]');assert(w.document.querySelector('#modal').open,'Explicit republish reopens the current content');await click('#modal [data-action=close]');
 await editNotice();noticeForm=w.document.querySelector('form[data-form=announcement]');noticeForm.querySelector('[name=active]').checked=false;await publishNotice();
 await click('[data-action=navigate][data-route=dashboard]');assert.equal(w.document.querySelector('.community-card'),null);assert(!w.document.querySelector('#modal').open);
 await click('[data-action=whatsapp]');assert.equal(w.document.querySelector('#modal a').href,'https://chat.whatsapp.com/EVLODOy777bBwDFkjNQIni');await click('#modal [data-action=close]');
 await editNotice();noticeForm=w.document.querySelector('form[data-form=announcement]');noticeForm.querySelector('[name=active]').checked=true;noticeForm.querySelector('[name=show_popup]').checked=false;noticeForm.querySelector('[name=image_url]').value='';
 [...w.document.querySelectorAll('[data-announcement-remove]')].forEach(b=>b.click());await publishNotice();
 await click('[data-action=navigate][data-route=dashboard]');assert(w.document.querySelector('.community-card'));assert(!w.document.querySelector('#modal').open);assert.equal(w.document.querySelector('.community-card img'),null);assert.equal(w.document.querySelector('.community-card a'),null);
 assert.equal(w.document.querySelector('.welcome-card'),null,'Announcement edits preserve prior welcome-coupon eligibility');
 await editNotice();noticeForm=w.document.querySelector('form[data-form=announcement]');const invalidRevision=Number(noticeForm.dataset.revision);noticeForm.querySelector('[name=image_url]').value='javascript:alert(1)';await publishNotice();
 assert(w.document.querySelector('form[data-form=announcement] .form-error').textContent.includes('links HTTPS'));
 assert.equal((await store.adminAnnouncementGet()).revision,invalidRevision,'Invalid editor contents cannot overwrite the last publication');
 console.log('DOM smoke: all user/admin/payment/coupon/profile flows plus announcement editing, live preview, image and multiple buttons, ordering, persistence, revision acknowledgement, republish, disable and card-only mode passed.');
}finally{await unlink(base+'/smoke-store.mjs');await unlink(base+'/smoke-main.mjs');}
