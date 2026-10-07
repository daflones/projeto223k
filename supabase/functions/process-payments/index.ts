import {admin,gateway,GatewayError,rpc,brl,toCents,workerSecret,matchesSecret} from '../_shared/backend.ts';
const MAX_SENDS=4,MAX_EVENTS=10,BUDGET_MS=60000;
async function processEvent(row:any){
 // The supplied v1 documentation omitted webhook JSON envelopes. Accept top-level/data;
 // require correlation fields; otherwise preserve in review (never infer a balance credit).
 const data=row.payload.data||row.payload;const reference=data.reference_id;
 if(!reference)throw new Error('Webhook sem reference_id; adaptar ao payload real');
 if(row.event==='pix.received'||row.event==='pix.refunded'){
 const {data:d}=await admin.from('deposits').select('*').eq('id',reference).single();if(!d)throw new Error('Depósito desconhecido');
 let id=d.provider_id||data.id;if(!id)throw new Error('Cobrança sem ID');
 const c=await gateway('/pix/charges/'+encodeURIComponent(id));if(c.reference_id!==d.id||toCents(c.amount)!==d.amount_cents)throw new Error('Cobrança divergente');
 if(!d.provider_id){const {error}=await admin.from('deposits').update({provider_id:String(c.id)}).eq('id',d.id);if(error)throw error;}
 if(!['completed','refunded','failed'].includes(c.status))throw new Error('Cobrança ainda não concluída');
 await rpc('settle_deposit',{p_id:d.id,p_provider_id:String(c.id),p_amount:toCents(c.amount),p_status:c.status,p_fee:toCents(c.fee||0)});
 }else if(row.event==='pix.sent'){
 const {data:w}=await admin.from('withdrawals').select('*').eq('id',reference).single();if(!w)throw new Error('Saque desconhecido');
 if(data.amount===undefined||data.total_debit===undefined||!data.id)throw new Error('Webhook sem amount, total_debit ou id');
 if(toCents(data.amount)!==w.payout_cents)throw new Error('Valor do saque divergente');
 // Deliberately never read net_amount: v1 changes its meaning between response/webhook.
 await rpc('settle_withdrawal',{p_id:w.id,p_status:'completed',p_provider_id:String(data.id),p_total_debit:toCents(data.total_debit)});
 }else throw new Error('Evento fora do escopo Pix');
}
async function withdrawalsEnabled(){
 const {data,error}=await admin.from('platform_settings').select('withdrawals_enabled').eq('id',1).single();
 if(error)throw error;return data?.withdrawals_enabled===true;
}
Deno.serve(async req=>{
 if(req.method!=='POST')return new Response('Method not allowed',{status:405});
 try{if(!await matchesSecret(req.headers.get('x-worker-secret'),workerSecret()))return new Response('Forbidden',{status:403});}catch{return new Response('Worker not configured',{status:503});}
 const started=Date.now();let done=0,handled=0,more=false,paused=false;try{
 const rows=((await rpc('claim_withdrawals',{p_limit:MAX_SENDS}))||[]).slice(0,MAX_SENDS);
 if(rows.length===MAX_SENDS)more=true;
 for(const w of rows){
 if(w.provider_id)continue;
 if(paused||Date.now()-started>BUDGET_MS){more=true;continue;}
 if(!await withdrawalsEnabled()){paused=true;more=true;continue;}
 try{
 const res=await gateway('/pix/withdrawals',{amount:brl(w.payout_cents),pix_key:w.pix_key,pix_key_type:w.pix_key_type,recipient_document:w.recipient_document,reference_id:w.id,description:'Saque Eletrify'});
 if(!res.id||res.reference_id!==w.id)throw new Error('Resposta sem correlação de saque');
 if(res.amount!==undefined&&toCents(res.amount)!==w.payout_cents)throw new Error('Resposta de saque divergente');
 const {error}=await admin.from('withdrawals').update({provider_id:String(res.id),total_debit_cents:res.total_debit===undefined?null:toCents(res.total_debit),last_error:null}).eq('id',w.id).eq('status','processing');if(error)throw error;
 if(res.status==='completed')await rpc('settle_withdrawal',{p_id:w.id,p_status:'completed',p_provider_id:String(res.id),p_total_debit:toCents(res.total_debit)});
 else if(res.status==='failed')await rpc('settle_withdrawal',{p_id:w.id,p_status:'failed',p_provider_id:String(res.id),p_error:'Recusa confirmada'});
 done++;
 }catch(e){
 if(e instanceof GatewayError&&e.status===422){await rpc('settle_withdrawal',{p_id:w.id,p_status:'failed',p_error:e.code});}
 else if(e instanceof GatewayError&&[401,403].includes(e.status)){await rpc('settle_withdrawal',{p_id:w.id,p_status:'review',p_error:e.code});}
 else {await admin.from('withdrawals').update({last_error:'Resposta incerta; repetir somente com a mesma reference_id.'}).eq('id',w.id);}
 }
 }
 const claimedEvents=(await rpc('claim_webhook_events',{p_limit:MAX_EVENTS}))||[];
 const events=claimedEvents.slice(0,MAX_EVENTS);
 if(claimedEvents.length>events.length||events.length===MAX_EVENTS)more=true;
 for(const row of events){
  if(Date.now()-started>BUDGET_MS){more=true;break;}
  try{
   await processEvent(row);
   const {error}=await admin.from('webhook_inbox').update({status:'processed',last_error:null}).eq('delivery_id',row.delivery_id).eq('claim_token',row.claim_token);
   if(error)throw error;
   handled++;
  }catch(e){
   const {error}=await admin.from('webhook_inbox').update({status:row.attempts>=5?'review':'pending',last_error:(e as Error).message.slice(0,500)}).eq('delivery_id',row.delivery_id).eq('claim_token',row.claim_token);
   if(error)throw error;
  }
 }
 // Recover charges with an unknown POST outcome. No POST charge retries (idempotency not documented).
 if(Date.now()-started<=BUDGET_MS){
 const {data:uncertain}=await admin.from('deposits').select('*').in('status',['creating','review']).limit(10);
 if(uncertain?.length){const list=await gateway('/pix/charges?limit=100');const charges=Array.isArray(list)?list:Array.isArray(list.data)?list:Array.isArray(list.charges)?list.charges:[];
 for(const d of uncertain){const c=charges.find((x:any)=>x.reference_id===d.id);if(c&&c.id&&toCents(c.amount)===d.amount_cents){
  const {data:recovered,error}=await admin.from('deposits').update({provider_id:String(c.id),status:'pending',qr_code:c.qr_code,qr_code_image:c.qr_code_image}).eq('id',d.id).in('status',['creating','review']).select('id').maybeSingle();
  if(error)throw error;if(!recovered)continue;
  if(['completed','failed'].includes(c.status))await rpc('settle_deposit',{p_id:d.id,p_provider_id:String(c.id),p_amount:d.amount_cents,p_status:c.status,p_fee:toCents(c.fee||0)});
 }}}
 }
 return Response.json({processed:done+handled,more});
 }catch(e){console.error('worker:',(e as Error).message);return Response.json({error:'Worker failed'},{status:500});}
});
