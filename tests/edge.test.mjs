import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {modelRequest,parsePet} from '../supabase/functions/mailbox-pet/policy.mjs';
import {petHandler} from '../supabase/functions/mailbox-pet/handler.js';
import {legacyProfile} from '../supabase/functions/_shared/ai-store.js';
import {callModel} from '../supabase/functions/_shared/ai-network.js';
import {allowedEndpoint,messageId,notificationPayload,sameSecret} from '../supabase/functions/mailbox-push/policy.mjs';
async function handler(file,admin,env,fetch=()=>{throw Error('Unexpected network');},webpush={setVapidDetails(){}}){
 if(file==='mailbox-pet')return petHandler({admin,env:k=>env[k],connection:async()=>{const p=legacyProfile(k=>env[k]);return p?{...p,revision:0}:null;},call:(p,k,task)=>callModel(p,k,task,async(url,options)=>{const r=await fetch(url,{...options,body:JSON.stringify(options.body)});if(!r.ok)throw Error('Upstream failed');return r.json();})});
 let serve;const source=(await readFile(new URL('../supabase/functions/'+file+'/index.ts',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
 vm.runInNewContext(stripTypeScriptTypes(source),{createClient:()=>admin,Deno:{env:{get:k=>env[k]},serve:f=>serve=f},Response,Request,AbortSignal,Date,JSON,Set,Boolean,fetch,modelRequest,parsePet,webpush,allowedEndpoint,messageId,notificationPayload,sameSecret});return serve;
}
const request=(body,headers={})=>new Request('https://server.test/',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
test('pet Edge authenticates before model calls and never accepts user supplied memory as its context',async()=>{
 let fetched=0,finished=0;const context=[{id:'1',text:'海边散步',author:'a'}],admin={auth:{getUser:async t=>({data:{user:t==='valid'?{id:'a'}:null}})},rpc:async(name,args)=>{
  if(name==='mailbox_pet_prepare'){assert.equal(args.p_user,'a');return {data:{request:'r',context}};}
  finished++;assert.equal(args.p_user,'a');return {data:{data:args.p_data}};
 }};
 const run=await handler('mailbox-pet',admin,{OPENAI_API_KEY:'test-key',MAILBOX_PET_MODEL:'configured'},async(url,options)=>{
  fetched++;assert.equal(url,'https://api.openai.com/v1/responses');const sent=JSON.parse(options.body);assert.deepEqual(JSON.parse(sent.input[0].content),context);assert.equal(sent.store,false);assert.ok(!options.body.includes('injected secret'));
  return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({name:'小光',mood:'calm',line:'记住散步。',traits:[],memories:[{text:'海边散步',sources:['1']}]})}]}]});
 });
 assert.equal((await run(request({room:'v2_room1'}))).status,401);assert.equal(fetched,0);
 assert.equal((await run(request({room:'v2_room1'},{authorization:'Bearer invalid'}))).status,401);assert.equal(fetched,0);
 assert.equal((await run(request({room:'v2_room1',user:'other',context:'injected secret'},{authorization:'Bearer valid'}))).status,200);assert.equal(fetched,1);assert.equal(finished,1);
});
test('pet Edge returns unavailable when unconfigured and rejects stale or invalid generated memories',async()=>{
 let calls=0;const admin={auth:{getUser:async()=>({data:{user:{id:'a'}}})},rpc:async()=>{calls++;return {error:{code:'42501'}};}};
 const off=await handler('mailbox-pet',admin,{});assert.equal((await off(request({room:'v2_room1'},{authorization:'Bearer valid'}))).status,503);assert.equal(calls,0);
 const denied=await handler('mailbox-pet',admin,{OPENAI_API_KEY:'test',MAILBOX_PET_MODEL:'configured'});assert.equal((await denied(request({room:'v2_room1'},{authorization:'Bearer valid'}))).status,403);assert.equal(calls,1);
});
test('scheduled delivery requires the cron secret, validates endpoints and marks failed delivery for retry',async()=>{
 const updates=[],sent=[],jobs=[{subscription_id:'s1',delivery_id:'notice-n1',source_id:'n1',room_id:'v2_room1',kind:'pocket',endpoint:'https://fcm.googleapis.com/ok',p256dh:'test',auth:'test'},{subscription_id:'s2',delivery_id:'bad',source_id:'n2',room_id:'v2_room1',kind:'todo',endpoint:'https://127.0.0.1/private'},{subscription_id:'s3',delivery_id:'notice-n3',source_id:'n3',room_id:'v2_room1',kind:'todo',endpoint:'https://fcm.googleapis.com/retry'}];
 let queued=0;const admin={rpc:async name=>{if(name==='mailbox_push_jobs'){queued++;return {data:jobs};}return {data:true};},from:()=>({update:data=>{updates.push(data);const q={eq:()=>q,then:resolve=>resolve({})};return q;}})};
 const webpush={setVapidDetails(){},async sendNotification(sub,payload){if(sub.endpoint.endsWith('/retry'))throw Error('temporary');sent.push(JSON.parse(payload));}};
 const run=await handler('mailbox-push',admin,{VAPID_PUBLIC_KEY:'test',VAPID_PRIVATE_KEY:'test',VAPID_SUBJECT:'mailto:test@example.test',MAILBOX_CRON_SECRET:'secret'},undefined,webpush);
 assert.equal((await run(request({action:'scheduled'}))).status,403);assert.equal(queued,0);
 assert.equal((await run(request({action:'scheduled'},{'x-mailbox-cron':'secret'}))).status,503);assert.equal(sent.length,1);assert.deepEqual(sent[0],{room:'v2_room1',id:'n1',kind:'pocket'});assert.ok(updates.some(x=>x.status==='failed'));assert.ok(updates.some(x=>x.status==='sent'));
});
