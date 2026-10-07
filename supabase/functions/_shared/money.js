// Integer cents internally; decimal BRL exclusively at the gateway boundary.
export function toCents(value) {
 const s=String(value);if(!/^\d+(\.\d{1,2})?$/.test(s))throw new Error('Valor monetário inválido');
 const [a,b='']=s.split('.');const n=Number(a)*100+Number(b.padEnd(2,'0'));
 if(!Number.isSafeInteger(n))throw new Error('Valor fora do limite');return n;
}
export function brl(cents){if(!Number.isSafeInteger(cents)||cents<0)throw new Error('Centavos inválidos');return Number(`${Math.floor(cents/100)}.${String(cents%100).padStart(2,'0')}`);}
export function dailyYield(cents,bps){if(!Number.isSafeInteger(cents)||!Number.isInteger(bps))throw new Error('Parâmetros inválidos');return Number(BigInt(cents)*BigInt(bps)/10000n);}
export function payout(cents){const fee=dailyYield(cents,500);return {amount_cents:cents,fee_cents:fee,payout_cents:cents-fee};}
export async function verifySignature(raw,headers,secret,now=Date.now()/1000){
 const ts=headers.get('x-mercosulpay-timestamp'),sig=headers.get('x-mercosulpay-signature');
 if(!secret||!ts||!/^\d+$/.test(ts)||Math.abs(now-Number(ts))>300||!/^sha256=[0-9a-f]{64}$/.test(sig||''))return false;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(ts+'.'+raw)));
 const expected='sha256='+Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');let mismatch=0;
 for(let i=0;i<expected.length;i++)mismatch|=expected.charCodeAt(i)^sig.charCodeAt(i);return mismatch===0;
}
