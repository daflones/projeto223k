import {admin,user,requireAdmin,workerSecret,HttpError,gateway,GatewayError,rpc,brl,toCents,response} from '../_shared/backend.ts';
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return response(req,{});if(req.method!=='POST')return response(req,{error:'Método inválido'},405);
 try{
 const body=await req.json();const amount=Number(body.amount_cents);
 if(body.action==='create_deposit'&&(!Number.isSafeInteger(amount)||amount<3500||amount>500000))return response(req,{error:'Depósito entre R$35 e R$5.000'},422);
 const u=await user(req);
 if(body.action==='create_deposit'){
 const id=String(body.request_id||'');if(!/^[a-f0-9-]{36}$/i.test(id))return response(req,{error:'Identificador inválido'},422);
 let {data:d}=await admin.from('deposits').select('*').eq('id',id).maybeSingle();
 if(d){if(d.user_id!==u.id||d.amount_cents!==amount)throw new Error('Identificador inválido');return response(req,{deposit:d});}
 const {data:uncertain}=await admin.from('deposits').select('id').eq('user_id',u.id).in('status',['creating','review']).limit(1);if(uncertain?.length)return response(req,{error:'Há uma cobrança em conciliação. Aguarde a conclusão antes de criar outra.'},409);
 const {error}=await admin.from('deposits').insert({id,user_id:u.id,amount_cents:amount});if(error)throw error;
 try{
 const charge=await gateway('/pix/charges',{amount:brl(amount),currency:'BRL',description:'Recarga Eletrify',reference_id:id});
 if(!charge.id||toCents(charge.amount)!==amount||charge.reference_id!==id||!charge.qr_code)throw new Error('Resposta da cobrança divergente');
 // A webhook can complete the charge before this HTTP response is persisted.
 // Never regress a settled transaction back to pending/failed/review.
 const {data,error:save}=await admin.from('deposits').update({provider_id:String(charge.id),status:'pending',qr_code:charge.qr_code,qr_code_image:charge.qr_code_image}).eq('id',id).in('status',['creating','review']).select().maybeSingle();if(save)throw save;
 const current=data||((await admin.from('deposits').select('*').eq('id',id).eq('user_id',u.id).single()).data);
 if(!current)throw new Error('Cobrança indisponível');
 return response(req,{deposit:current});
 }catch(e){const permanent=e instanceof GatewayError&&([401,403,422].includes(e.status)||e.code==='gateway_not_configured');await admin.from('deposits').update({status:permanent?'failed':'review',last_error:permanent?(e as Error).message:'Criação incerta; conciliar antes de gerar nova cobrança.'}).eq('id',id).in('status',['creating','review']);return response(req,{error:permanent?'A cobrança foi recusada. Verifique a configuração da gateway.':'A criação ficou pendente de conciliação. Não repita com outro identificador.'},502);}
 }
 if(body.action==='check_deposit'){
 const {data:d}=await admin.from('deposits').select('*').eq('id',body.id).eq('user_id',u.id).single();if(!d||!d.provider_id)throw new Error('Cobrança indisponível');
 const c=await gateway('/pix/charges/'+encodeURIComponent(d.provider_id));if(c.reference_id!==d.id)throw new Error('Referência divergente');
 await rpc('settle_deposit',{p_id:d.id,p_provider_id:String(c.id),p_amount:toCents(c.amount),p_status:c.status,p_fee:toCents(c.fee||0)});
 return response(req,{status:c.status});
 }

 if(body.action==='admin_update_email'||body.action==='admin_reset_password'){
 requireAdmin(u);
 const {data:account,error:accountError}=await admin.auth.admin.getUserById(body.user_id);if(accountError||!account.user)throw new Error('Usuário não encontrado');
 if(body.action==='admin_update_email'){
 if(!body.email||!body.email.includes('@')||String(body.reason||'').length<5)throw new Error('Informe e-mail e motivo');
 const {error}=await admin.auth.admin.updateUserById(body.user_id,{email:body.email});if(error)throw error;
 }else{
 const {error}=await admin.auth.resetPasswordForEmail(account.user.email!,{redirectTo:Deno.env.get('APP_URL')+'/?flow=recovery'});if(error)throw error;
 }
 const {error:log}=await admin.from('admin_audit').insert({admin_id:u.id,action:body.action,details:{user_id:body.user_id,email:body.email||null,reason:body.reason||'Recuperação solicitada'}});if(log)throw log;
 return response(req,{ok:true});
 }
 if(body.action==='process_approved'){
 requireAdmin(u);
 const endpoint=Deno.env.get('SUPABASE_URL')+'/functions/v1/process-payments';
 const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','x-worker-secret':workerSecret()},body:'{}',signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw new HttpError(502,'O worker não conseguiu processar a solicitação');
 return response(req,{queued:true});
 }
 return response(req,{error:'Ação desconhecida'},422);
 }catch(e){if(e instanceof HttpError)return response(req,{error:e.message},e.status);console.error('payments:',(e as Error).message);return response(req,{error:'Não foi possível concluir a operação. Confira os dados e a configuração.'},400);}
});
