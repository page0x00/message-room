import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import webpush from 'npm:web-push@3.6.7';
import { allowedEndpoint, messageId, notificationPayload, sameSecret } from './policy.mjs';
const url=Deno.env.get('SUPABASE_URL')!;
const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const origin=Deno.env.get('MAILBOX_ORIGIN')||'https://page0x00.github.io';
const cors={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Vary':'Origin'};
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json'}});
async function deliver(jobs:any[]){
 let sent=0,failed=0,offset=0;
 async function one(job:any){
  if(!allowedEndpoint(job.endpoint))return;
  const claim=await admin.rpc('mailbox_claim_push',{p_subscription:job.subscription_id,p_message:job.delivery_id});if(claim.error)throw claim.error;if(!claim.data)return;
  try{
   const payload=job.kind==='message'?notificationPayload({room_id:job.room_id,id:job.source_id}):JSON.stringify({room:job.room_id,id:job.source_id,kind:job.kind});
   await webpush.sendNotification({endpoint:job.endpoint,keys:{p256dh:job.p256dh,auth:job.auth}},payload,{TTL:job.kind==='listen'?600:3600,urgency:'normal',timeout:8000});
   const mark=await admin.from('mailbox_push_deliveries').update({status:'sent'}).eq('subscription_id',job.subscription_id).eq('message_id',job.delivery_id);if(mark.error)throw mark.error;sent++;
  }catch(e){
   const code=typeof e==='object'&&e!==null&&'statusCode' in e?e.statusCode:null;
   if(code===404||code===410)await admin.from('push_subscriptions').delete().eq('id',job.subscription_id);
   else{await admin.from('mailbox_push_deliveries').update({status:'failed',lease_until:new Date(Date.now()+60000).toISOString()}).eq('subscription_id',job.subscription_id).eq('message_id',job.delivery_id);failed++;}
  }
 }
 // At most four requests at once; a 20-item cron batch fits the network deadline.
 await Promise.all(Array.from({length:Math.min(4,jobs.length)},async()=>{while(offset<jobs.length){const job=jobs[offset++];try{await one(job);}catch{failed++;}}}));
 return {sent,failed};
}
Deno.serve(async req=>{
 try{
  if(req.headers.get('origin')&&req.headers.get('origin')!==origin)return reply({error:'Origin denied'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  const publicKey=Deno.env.get('VAPID_PUBLIC_KEY'),privateKey=Deno.env.get('VAPID_PRIVATE_KEY'),subject=Deno.env.get('VAPID_SUBJECT');
  if(!publicKey||!privateKey||!subject)return reply({error:'Push not configured'},503);
  if(req.method==='GET')return reply({publicKey});
  if(req.method!=='POST')return reply({error:'Method not allowed'},405);
  const input=await req.text();if(input.length>65536)return reply({error:'Payload too large'},413);
  let body;try{body=JSON.parse(input);}catch{return reply({error:'Invalid JSON'},400);}
  webpush.setVapidDetails(subject,publicKey,privateKey);
  if(body.action==='scheduled'){
   if(!await sameSecret(req.headers.get('x-mailbox-cron'),Deno.env.get('MAILBOX_CRON_SECRET')))return reply({error:'Scheduler authentication required'},403);
   const jobs=await admin.rpc('mailbox_push_jobs');if(jobs.error)throw jobs.error;
   const result=await deliver(jobs.data||[]);return reply(result,result.failed?503:200);
  }
  const webhook=await sameSecret(req.headers.get('x-mailbox-webhook'),Deno.env.get('MAILBOX_WEBHOOK_SECRET'));
  if(webhook&&(body.type!=='INSERT'||body.table!=='messages'||body.schema!=='public'))return reply({skipped:true});
  const id=messageId(webhook?body.record?.id:body.message_id);if(!id)return reply({error:'Invalid message'},400);
  // Never trust the webhook body for recipient, room, sender or message content.
  const {data:message,error}=await admin.from('messages').select('id,room_id,author_id,created_at').eq('id',id).maybeSingle();
  if(error)throw error;
  if(!message?.author_id||!message.room_id.startsWith('v2_'))return reply({skipped:true});
  if(!webhook){
   const token=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'');if(!token)return reply({error:'Authentication required'},401);
   const {data,error:authError}=await admin.auth.getUser(token);
   if(authError||data.user?.id!==message.author_id)return reply({error:'Author required'},403);
   if(Date.now()-Date.parse(message.created_at)>600000)return reply({error:'Message too old'},409);
  }
  const {data:members,error:memberError}=await admin.from('room_members').select('user_id').eq('room_id',message.room_id);if(memberError)throw memberError;
  if(!members?.some(row=>row.user_id===message.author_id))return reply({skipped:true});
  const recipients=new Set(members.map(row=>row.user_id).filter(id=>id!==message.author_id));
  const {data:subscriptions,error:subError}=await admin.from('push_subscriptions').select('id,user_id,endpoint,p256dh,auth').eq('room_id',message.room_id);if(subError)throw subError;
  const jobs=(subscriptions||[]).filter(sub=>recipients.has(sub.user_id)).map(sub=>({...sub,subscription_id:sub.id,delivery_id:String(message.id),source_id:String(message.id),room_id:message.room_id,kind:'message'}));
  const result=await deliver(jobs);return reply(result,result.failed?503:200);
 }catch{return reply({error:'Delivery unavailable'},503);}
});
