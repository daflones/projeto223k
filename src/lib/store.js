import {createClient} from '@supabase/supabase-js';
import {toCents,payout,dailyYield} from '../../supabase/functions/_shared/money.js';
export {toCents,payout,dailyYield};
const runtime=window.ELETRIFY_CONFIG||{};
export const client=(runtime.supabaseUrl||import.meta.env.VITE_SUPABASE_URL)&&(runtime.supabaseKey||import.meta.env.VITE_SUPABASE_ANON_KEY)?createClient(runtime.supabaseUrl||import.meta.env.VITE_SUPABASE_URL,runtime.supabaseKey||import.meta.env.VITE_SUPABASE_ANON_KEY):null;
let demoApi=null;
export const isDemo=()=>!!demoApi;
export async function enterDemo(){if(!import.meta.env.DEV)throw new Error('Demonstração indisponível neste ambiente');if(!demoApi)demoApi=(await import('./demo.js')).enter();return demoApi.snapshot(false);}
export function resetDemo(){return demoApi?.reset();}
export function leaveDemo(){demoApi=null;}
export async function snapshot(admin=false){if(demoApi)return demoApi.snapshot(admin);const {data,error}=await client.rpc('app_snapshot',{p_admin:admin});if(error)throw error;return data;}
export async function action(name,data={}){
 if(demoApi)return demoApi.action(name,data);
 const {data:out,error}=await client.rpc('app_action',{p_action:name,p_data:{...data,request_id:data.request_id||crypto.randomUUID()}});if(error)throw error;return out;
}
export async function payment(name,data={}){
 if(demoApi)return demoApi.payment(name,data);
 const {data:out,error}=await client.functions.invoke('payments',{body:{action:name,...data}});if(error||out?.error)throw new Error(out?.error||error.message);return out;
}
