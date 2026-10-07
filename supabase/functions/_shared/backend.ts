import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
import {brl,toCents} from './money.js';
export const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
const allowed=(Deno.env.get('APP_ORIGINS')||'http://localhost:5173').split(',').map(x=>x.trim()).filter(Boolean);
export function cors(req:Request){const origin=req.headers.get('origin')||'';return {'Access-Control-Allow-Origin':allowed.includes(origin)?origin:allowed[0],'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'};}
export function response(req:Request,body:unknown,status=200){return Response.json(body,{status,headers:cors(req)});}
export class HttpError extends Error {status:number;constructor(status:number,message:string){super(message);this.status=status;}}
export async function user(req:Request){
 const header=req.headers.get('authorization')||'';
 if(!/^Bearer\s+\S+$/i.test(header))throw new HttpError(401,'Autenticação necessária');
 const token=header.replace(/^Bearer\s+/i,'');
 const {data,error}=await admin.auth.getUser(token);
 if(error||!data.user)throw new HttpError(401,'Sessão inválida');
 // Read the current database row on every call. A JWT/user_metadata field,
 // request body or a stale client snapshot cannot promote the caller.
 const {data:p,error:profileError}=await admin.from('profiles').select('id,blocked,is_admin').eq('id',data.user.id).single();
 if(profileError||!p||p.blocked!==false)throw new HttpError(403,'Conta indisponível');
 return {...data.user,profile:p};
}
export function requireAdmin(u:Awaited<ReturnType<typeof user>>){
 if(u.profile.is_admin!==true||u.profile.blocked!==false)throw new HttpError(403,'Acesso administrativo negado');
}
export function workerSecret(){
 const secret=Deno.env.get('WORKER_SECRET')||'';
 if(secret.length<32||/SUBSTITUIR|^UM_SEGREDO/i.test(secret))throw new HttpError(503,'Configure o segredo do worker');
 return secret;
}
export async function matchesSecret(provided:string|null,expected:string){
 if(!provided)return false;
 const encode=new TextEncoder();
 const a=new Uint8Array(await crypto.subtle.digest('SHA-256',encode.encode(provided)));
 const b=new Uint8Array(await crypto.subtle.digest('SHA-256',encode.encode(expected)));
 let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;
}
export class GatewayError extends Error {status:number;code:string;constructor(status:number,code:string){super(code);this.status=status;this.code=code;}}
export async function gateway(path:string,body?:unknown){
 const key=Deno.env.get('MERCOSULPAY_API_KEY');if(!key)throw new GatewayError(503,'gateway_not_configured');
 const r=await fetch('https://mercosulpay.com/api/public/v1'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
 const json=await r.json();if(!r.ok)throw new GatewayError(r.status,json.error?.code||'gateway_error');return json;
}
export async function rpc(name:string,args:unknown){const {data,error}=await admin.rpc(name,args);if(error)throw error;return data;}
export {brl,toCents};
