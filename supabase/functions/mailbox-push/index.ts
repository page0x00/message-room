import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import webpush from 'npm:web-push@3.6.7';
import { allowedEndpoint, messageId, notificationPayload, sameSecret } from './policy.mjs';
const url=Deno.env.get('SUPABASE_URL')!;
const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const origin=Deno.env.get('MAILBOX_ORIGIN')||'https://page0x00.github.io';
const cors={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Vary':'Origin'};
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json'}});
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
  webpush.setVapidDetails(subject,publicKey,privateKey);
  let sent=0,failed=0;
  // Sequential delivery caps outbound concurrency; deduplication also covers client fallback.
  for(const sub of subscriptions||[]){
   if(!recipients.has(sub.user_id)||!allowedEndpoint(sub.endpoint))continue;
   const claim=await admin.rpc('mailbox_claim_push',{p_subscription:sub.id,p_message:String(message.id)});if(claim.error)throw claim.error;if(!claim.data)continue;
   try{
    await webpush.sendNotification({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth}},notificationPayload(message),{TTL:3600,urgency:'normal',timeout:10000});
    const mark=await admin.from('mailbox_push_deliveries').update({status:'sent'}).eq('subscription_id',sub.id).eq('message_id',String(message.id));if(mark.error)throw mark.error;sent++;
   }catch(e){
    const statusCode=typeof e==='object'&&e!==null&&'statusCode' in e?e.statusCode:null;
    if(statusCode===404||statusCode===410)await admin.from('push_subscriptions').delete().eq('id',sub.id);
    else{await admin.from('mailbox_push_deliveries').update({status:'failed',lease_until:new Date(Date.now()+60000).toISOString()}).eq('subscription_id',sub.id).eq('message_id',String(message.id));failed++;}
   }
  }
  return reply({sent,failed},failed?503:200);
 }catch{return reply({error:'Delivery unavailable'},503);}
});
