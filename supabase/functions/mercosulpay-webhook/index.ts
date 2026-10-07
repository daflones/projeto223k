import {admin} from '../_shared/backend.ts';
import {verifySignature} from '../_shared/money.js';
Deno.serve(async req=>{
 if(req.method!=='POST')return new Response('Method not allowed',{status:405});
 const secret=Deno.env.get('MERCOSULPAY_WEBHOOK_SECRET');
 if(!secret||/SUBSTITUIR/i.test(secret))return new Response('Webhook not configured',{status:503});
 const raw=await req.text();if(raw.length>1000000)return new Response('Payload too large',{status:413});
 if(!await verifySignature(raw,req.headers,secret))return new Response('Invalid signature',{status:401});
 const delivery=req.headers.get('x-mercosulpay-delivery'),event=req.headers.get('x-mercosulpay-event');
 if(!delivery||delivery.length>200||!event)return new Response('Invalid headers',{status:400});
 try{
 const payload=JSON.parse(raw);
 const {error}=await admin.from('webhook_inbox').insert({delivery_id:delivery,event,payload});
 if(error&&error.code!=='23505')throw error;
 // Durable inbox first. Scheduled worker processes and reconciles; ACK never means credited.
 return Response.json({received:true});
 }catch{return new Response('Unable to persist event',{status:503});}
});
