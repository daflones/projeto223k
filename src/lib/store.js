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
export async function welcomeCouponStatus(){
 if(demoApi){const state=await demoApi.snapshot(false);const redeemed=state.couponRedemptions.some(r=>r.user_id===state.profile.id&&r.code==='ELETRIFY');let coupon=null;if(!redeemed){try{coupon=await demoApi.couponPreview('ELETRIFY');}catch{}}return {code:'ELETRIFY',redeemed,coupon};}
 const {data,error}=await client.rpc('welcome_coupon_status');if(error)throw error;return data;
}
export async function couponPreview(code){if(demoApi)return demoApi.couponPreview(code);const {data,error}=await client.rpc('coupon_preview',{p_code:code});if(error)throw error;return data;}
export async function couponRedeem(code,optionIds,requestId){if(demoApi)return demoApi.couponRedeem(code,optionIds,requestId);const {data,error}=await client.rpc('coupon_redeem',{p_code:code,p_option_ids:optionIds,p_request_id:requestId});if(error)throw error;return data;}
export async function couponAdminList(){if(demoApi)return demoApi.couponAdminList();const {data,error}=await client.rpc('coupon_admin_list');if(error)throw error;return data;}
export async function couponAdminSave(config){if(demoApi)return demoApi.couponAdminSave(config);const {data,error}=await client.rpc('coupon_admin_save',{p_data:config});if(error)throw error;return data;}
export async function adminOverview(){if(demoApi)return demoApi.adminOverview();const {data,error}=await client.rpc('admin_overview');if(error)throw error;return data;}
export async function adminPageData({section,page=1,page_size=20,search='',status='',user_id=null,level=1}){
 if(demoApi)return demoApi.adminPage({section,page,page_size,search,status,user_id,level});
 const {data,error}=await client.rpc('admin_page',{p_section:section,p_page:page,p_page_size:page_size,p_search:search,p_status:status,p_user_id:user_id,p_level:level});if(error)throw error;return data;
}
export async function adminUserProfile(id){if(demoApi)return demoApi.adminUserProfile(id);const {data,error}=await client.rpc('admin_user_profile',{p_user_id:id});if(error)throw error;return data;}
export async function currentAnnouncement(){if(demoApi)return demoApi.currentAnnouncement();const {data,error}=await client.rpc('announcement_current');if(error)throw error;return data;}
export async function adminAnnouncementGet(){if(demoApi)return demoApi.adminAnnouncementGet();const {data,error}=await client.rpc('announcement_admin_get');if(error)throw error;return data;}
export async function adminAnnouncementSave(config,revision,republish=false){if(demoApi)return demoApi.adminAnnouncementSave(config,revision,republish);const {data,error}=await client.rpc('announcement_admin_save',{p_data:config,p_expected_revision:revision,p_republish:republish});if(error)throw error;return data;}
export async function payment(name,data={}){
 if(demoApi)return demoApi.payment(name,data);
 const {data:out,error}=await client.functions.invoke('payments',{body:{action:name,...data}});if(error||out?.error)throw new Error(out?.error||error.message);return out;
}
