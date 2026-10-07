// Módulo de demonstração: usado apenas em desenvolvimento (import.meta.env.DEV)
// e pelos testes de interface. Não entra no bundle de produção — o store importa
// este arquivo dinamicamente atrás de uma guarda compilável.
import {dailyYield,payout} from '../../supabase/functions/_shared/money.js';
const iso=()=>new Date().toISOString();const uid='demo-user';
const products=[['Patinete urbano','production','patinete-bateria-componentes',7000,500],['Drone inteligente','production','drone-eletronica-carcaca-bateria',22000,600],['Moto elétrica','production','moto-estrutura-bateria-motor',64000,700],['SUV elétrico','production','carro-carroceria-chassi-baterias',160000,800],['Lote de patinetes','distribution','lote-quatro-patinetes-eletricos',12000,500],['Lote de drones','distribution','lote-tres-drones-maleta-transporte',32000,600],['Lote de motos','distribution','lote-tres-motos-eletricas',93000,700],['Lote de SUVs','distribution','lote-tres-carros-eletricos',250000,800]].map((p,i)=>({id:'prod-'+i,name:p[0],category:p[1],image:'/assets/'+p[2]+'.png',price_cents:p[3],daily_bps:p[4],duration_days:p[1]==='production'?10:15,active:true,description:'Imagem conceitual do projeto de '+(p[1]==='production'?'produção':'distribuição')+'. Confira prazo e condições antes de adquirir.'}));
function seed(){const date=new Date(Date.now()-2*86400000).toISOString();return {profile:{id:uid,full_name:'Eduardo Daflon',whatsapp:'',referral_code:'ELETRIFY-DEMO',is_admin:true,contact_consent:false,blocked:false},wallet:{user_id:uid,available_cents:143700,reserved_cents:0},settings:{withdrawals_enabled:true,commission_bps:[1500,500,200],whatsapp_group:'',return_principal:true},products:structuredClone(products),positions:[{...products[0],id:'position-demo',product_id:products[0].id,user_id:uid,payer_id:uid,principal_cents:7000,paid_periods:2,earned_cents:700,status:'active',created_at:date,return_principal:true,principal_returned:false}],ledger:[{id:'entry4',kind:'yield',amount_cents:350,available_delta:350,reserved_delta:0,description:'Rendimento de demonstração · dia 2',created_at:new Date(new Date(date).getTime()+2*86400000).toISOString()},{id:'entry3',kind:'yield',amount_cents:350,available_delta:350,reserved_delta:0,description:'Rendimento de demonstração · dia 1',created_at:new Date(new Date(date).getTime()+86400000).toISOString()},{id:'entry2',kind:'purchase',amount_cents:-7000,available_delta:-7000,reserved_delta:0,description:'Compra de demonstração: Patinete urbano',created_at:date},{id:'entry1',kind:'deposit',amount_cents:150000,available_delta:150000,reserved_delta:0,description:'Depósito de demonstração',created_at:date}],deposits:[],withdrawals:[],commissions:[],transfers:[],team:[{id:'team-1',full_name:'Camila Santos',whatsapp:'',level:1,active:true,products:[{name:'Drone inteligente',status:'active',principal_cents:22000}]},{id:'team-2',full_name:'Lucas Oliveira',whatsapp:'',level:2,active:false,products:[]},{id:'team-3',full_name:'Marina Costa',whatsapp:'',level:3,active:true,products:[{name:'Lote de patinetes',status:'active',principal_cents:12000}]}],admin:{users:[],positions:[],withdrawals:[],deposits:[],audit:[],webhooks:[]}};}
let state;
function load(){try{return JSON.parse(localStorage.getItem('eletrify-demo-v3'))||seed();}catch{return seed();}}
function save(){localStorage.setItem('eletrify-demo-v3',JSON.stringify(state));}
function entry(kind,amount,desc){state.ledger.unshift({id:crypto.randomUUID(),kind,amount_cents:amount,available_delta:amount,reserved_delta:0,description:desc,created_at:iso()});}
function processDemoYields(){
 let changed=false;
 for(const p of state.positions){
  const owner=p.user_id===uid?state.profile:state.team.find(t=>t.id===p.user_id);
  if(p.status!=='active'||!owner||owner.blocked)continue;
  const wallet=p.user_id===uid?state.wallet:(owner.wallet||={available_cents:0,reserved_cents:0});
  const due=Math.min(p.duration_days,Math.max(0,Math.floor((Date.now()-Date.parse(p.created_at))/86400000)));
  const amount=dailyYield(p.principal_cents,p.daily_bps);
  for(let period=p.paid_periods+1;period<=due;period++){
   wallet.available_cents+=amount;p.earned_cents+=amount;
   if(p.user_id===uid)entry('yield',amount,'Rendimento de demonstração: '+p.name+' · dia '+period);
   changed=true;
  }
  if(due>p.paid_periods)p.paid_periods=due;
  if(due>=p.duration_days){
   if(p.return_principal&&!p.principal_returned){
    wallet.available_cents+=p.principal_cents;p.principal_returned=true;
    if(p.user_id===uid)entry('principal_return',p.principal_cents,'Devolução de capital de demonstração: '+p.name);
   }
   p.status='completed';changed=true;
  }
 }
 if(changed)save();
}
function sync(){processDemoYields();for(const t of state.team){const ps=state.positions.filter(p=>p.user_id===t.id);for(const p of ps){const current=t.products.find(x=>x.id===p.id);const summary={id:p.id,name:p.name,status:p.status,principal_cents:p.principal_cents};if(current)Object.assign(current,summary);else t.products.push(summary);}t.active=t.products.some(p=>p.status==='active');}state.admin.users=[{...state.profile,wallet:state.wallet},...state.team.map(t=>({...t,whatsapp:t.whatsapp,blocked:!!t.blocked,wallet:t.wallet||{available_cents:0,reserved_cents:0}}))];state.admin.positions=state.positions;state.admin.withdrawals=state.withdrawals;state.admin.deposits=state.deposits;}
function demoTransfers(){return (state.transfers||[]).filter(x=>x.sender_id===uid||x.recipient_id===uid).map(x=>{const other=x.sender_id===uid?x.recipient_id:x.sender_id;return {direction:x.sender_id===uid?'sent':'received',counterparty:other===uid?state.profile.full_name:state.team.find(u=>u.id===other)?.full_name||'Usuário',amount_cents:x.amount_cents,created_at:x.created_at};});}
const api={
 reset(){state=seed();save();sync();return state;},
 async snapshot(admin){sync();if(state.profile.blocked)throw new Error('Conta suspensa. Contate o suporte.');if(admin&&state.profile.is_admin!==true)throw new Error('Acesso administrativo negado');return admin?state:{...state,admin:undefined,transfers:demoTransfers()};},
 async action(name,data={}){
  if(name.startsWith('admin_')&&(state.profile.is_admin!==true||state.profile.blocked))throw new Error('Acesso administrativo negado');
  const out={};
  if(name==='purchase'||name==='gift'){
   const p=state.products.find(p=>p.id===data.product_id&&p.active);if(!p)throw new Error('Produto indisponível');const n=Number(data.quantity||1);if(n<1||n>100)throw new Error('Quantidade inválida');const price=p.price_cents*n;if(price>state.wallet.available_cents)throw new Error('Saldo insuficiente');state.wallet.available_cents-=price;entry('purchase',-price,'Compra: '+p.name+(name==='gift'?' · presente':''));
   for(let i=0;i<n;i++){state.positions.unshift({...p,id:crypto.randomUUID(),product_id:p.id,user_id:name==='gift'?data.user_id:uid,payer_id:uid,principal_cents:p.price_cents,earned_cents:0,paid_periods:0,return_principal:state.settings.return_principal,principal_returned:false,status:'active',created_at:iso()});}
  }else if(name==='withdrawal'){
   const a=Number(data.amount_cents);if(!state.settings.withdrawals_enabled)throw new Error('Saques desativados');if(!Number.isSafeInteger(a)||a<3000||a>1000000)throw new Error('Saque entre R$30 e R$10.000');if(a>state.wallet.available_cents)throw new Error('Saldo insuficiente');
   const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(new Date());if(state.withdrawals.some(w=>w.day_key===day&&w.user_id===uid))throw new Error('Você já solicitou um saque hoje');if(!state.positions.some(p=>p.user_id===uid&&['active','completed'].includes(p.status)))throw new Error('Adquira um produto antes de sacar');
   const w={...data,...payout(a),id:crypto.randomUUID(),user_id:uid,status:'requested',day_key:day,created_at:iso()};state.withdrawals.unshift(w);state.wallet.available_cents-=a;state.wallet.reserved_cents+=a;entry('withdrawal_requested',-a,'Saque solicitado · demonstração');
  }else if(name==='transfer'){
   const a=data.amount_cents;if(a>10000||a<=0||a>state.wallet.available_cents)throw new Error('Confira saldo e limite diário de R$100');const day=new Date().toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'});const sent=state.ledger.filter(x=>x.kind==='transfer'&&new Date(x.created_at).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'})===day).reduce((s,x)=>s-x.amount_cents,0);if(sent+a>10000)throw new Error('Limite diário de R$100');state.wallet.available_cents-=a;const t=state.team.find(t=>t.id===data.user_id);t.wallet=t.wallet||{available_cents:0,reserved_cents:0};t.wallet.available_cents+=a;state.transfers.push({id:crypto.randomUUID(),sender_id:uid,recipient_id:data.user_id,amount_cents:a,created_at:iso()});entry('transfer',-a,'Doação para afiliado');
  }else if(name==='profile'){Object.assign(state.profile,data);
  }else if(name==='admin_product'){const ix=state.products.findIndex(p=>p.id===data.id);if(ix>=0)state.products[ix]={...state.products[ix],...data};else state.products.push({...data,id:crypto.randomUUID()});
  }else if(name==='admin_settings'){state.settings={...state.settings,...data,commission_bps:[data.level1_bps,data.level2_bps,data.level3_bps]};
  }else if(name==='admin_user'){const p=data.user_id===uid?state.profile:state.team.find(u=>u.id===data.user_id);Object.assign(p,data);
  }else if(name==='admin_balance'){if(data.user_id===uid){const delta=data.amount_cents-state.wallet.available_cents;state.wallet.available_cents=data.amount_cents;entry('admin_adjustment',delta,data.reason);}else state.team.find(u=>u.id===data.user_id).wallet={available_cents:data.amount_cents,reserved_cents:0};
  }else if(name==='admin_position'){if(data.id)Object.assign(state.positions.find(p=>p.id===data.id),data);else{const p=state.products.find(p=>p.id===data.product_id);state.positions.push({...p,id:crypto.randomUUID(),user_id:data.user_id,payer_id:uid,principal_cents:p.price_cents,paid_periods:0,earned_cents:0,return_principal:state.settings.return_principal,principal_returned:false,status:'active',created_at:iso()});}
  }else if(name==='admin_approve'||name==='admin_reject'){for(const id of data.ids){const w=state.withdrawals.find(w=>w.id===id);if(w.status!=='requested')continue;if(name==='admin_reject'){w.status='rejected';state.wallet.available_cents+=w.amount_cents;state.wallet.reserved_cents-=w.amount_cents;entry('withdrawal_rejected',w.amount_cents,'Saque rejeitado');}else w.status='approved';}
  }else if(name==='admin_approve_all'){if(!state.settings.withdrawals_enabled)throw new Error('Saques desativados');const ws=state.withdrawals.filter(w=>w.status==='requested');for(const w of ws)w.status='approved';out.approved=ws.length;}
  if(name.startsWith('admin_'))state.admin.audit.unshift({id:crypto.randomUUID(),action:name,details:data,created_at:iso()});save();sync();return out;
 },
 async payment(name,data={}){
  if((name.startsWith('admin_')||name==='process_approved')&&(state.profile.is_admin!==true||state.profile.blocked))throw new Error('Acesso administrativo negado');
  if(name==='create_deposit'){const amount=Number(data.amount_cents);if(!Number.isSafeInteger(amount)||amount<3500||amount>500000)throw new Error('Depósito entre R$35 e R$5.000');const d={id:crypto.randomUUID(),amount_cents:amount,status:'pending',created_at:iso()};state.deposits.unshift(d);save();return {deposit:d};}
  if(name==='check_deposit'){const d=state.deposits.find(d=>d.id===data.id);if(d.status!=='completed'){d.status='completed';state.wallet.available_cents+=d.amount_cents;entry('deposit',d.amount_cents,'Depósito de demonstração');}save();return {status:d.status};}
  if(name==='process_approved'){for(const w of state.withdrawals.filter(w=>w.status==='approved')){w.status='completed';state.wallet.reserved_cents-=w.amount_cents;entry('withdrawal_completed',0,'Saque de demonstração concluído');}save();return {queued:true};}
  return {};
 }
};
export function enter(){state=load();sync();return api;}
