import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {providers,normalizeProfile,buildRequest,responseJSON,probeTask,requestHeaders} from '../supabase/functions/_shared/ai-providers.js';
import {sealKey,openKey,currentConnection} from '../supabase/functions/_shared/ai-store.js';
import {callModel,providerJSON,publicAddress} from '../supabase/functions/_shared/ai-network.js';
import {apiHandler} from '../supabase/functions/mailbox-api/handler.js';
import {petHandler} from '../supabase/functions/mailbox-pet/handler.js';
const profile=(id='openrouter',patch={})=>normalizeProfile({...providers.find(p=>p.id===id),provider:id,name:'我的连接',model:'test-model',...patch});
const env=k=>({MAILBOX_API_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')})[k];
const fixtures={responses:{status:'completed',output:[{content:[{type:'output_text',text:'{"ok":true}'}]}]},chat:{choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}]},anthropic:{stop_reason:'end_turn',content:[{type:'text',text:'{"ok":true}'}]},gemini:{candidates:[{finishReason:'STOP',content:{parts:[{text:'{"ok":true}'}]}}]}};
test('four native protocols send expected endpoints/auth and decode real response envelopes',async()=>{
 for(const [id,path,auth] of [['openai','/responses','Authorization'],['openrouter','/chat/completions','Authorization'],['anthropic','/messages','x-api-key'],['gemini','/models/test-model:generateContent','x-goog-api-key']]){
  const p=profile(id),seen=[];const answer=await callModel(p,'dummy-key',probeTask,async(url,options)=>{seen.push({url,...options});return fixtures[p.protocol];});
  assert.deepEqual(answer,{ok:true});assert.ok(seen[0].url.endsWith(path));assert.ok(seen[0].headers[auth].includes('dummy-key'));assert.ok(!JSON.stringify(seen[0].body).includes('dummy-key'));
 }
 assert.equal(requestHeaders(profile('azure',{base_url:'https://resource.openai.azure.com/openai/v1'}),'key')['api-key'],'key');
});
test('advanced overrides, zero values and final nested exclusions reach the outbound body',async()=>{
 const p=profile('openrouter',{params:{temperature:0,seed:0,frequency_penalty:0,max_tokens:3200},extra:{max_completion_tokens:4096,reasoning:{effort:'low',enabled:true},temperature:0.7},exclude:['temperature','max_tokens','reasoning.effort','response_format']});
 await callModel(p,'dummy',probeTask,async(url,{body})=>{assert.equal(body.seed,0);assert.equal(body.frequency_penalty,0);assert.equal(body.max_completion_tokens,4096);assert.deepEqual(body.reasoning,{enabled:true});for(const k of ['temperature','max_tokens','response_format'])assert.ok(!Object.hasOwn(body,k));assert.equal(body.messages.length,2);return fixtures.chat;});
 const g=buildRequest(profile('gemini',{params:{temperature:0,top_p:0.2,max_tokens:600,stop:['END']},exclude:['generationConfig.responseMimeType']}),probeTask).body;
 assert.deepEqual(g.generationConfig,{maxOutputTokens:600,temperature:0,topP:0.2,stopSequences:['END']});
 assert.equal(buildRequest(profile('openai',{params:{reasoning_effort:'low'},exclude:['text.format','reasoning']}),probeTask).body.text,undefined);
});
test('parameters cannot replace trusted context, execute tools, pollute prototypes or remove required fields',()=>{
 for(const extra of [{messages:[]},{input:'injected'},{tools:[{}]},{stream:true},JSON.parse('{"x":{"__proto__":{"polluted":true}}}')])assert.throws(()=>profile('custom',{base_url:'https://api.example.com/v1',extra}));
 for(const exclude of [['messages'],['model'],['systemInstruction.parts'],['__proto__.x']])assert.throws(()=>profile('openrouter',{exclude}));
 assert.throws(()=>profile('anthropic',{exclude:['max_tokens']}));assert.throws(()=>profile('openrouter',{params:{temperature:4}}));assert.throws(()=>profile('openrouter',{params:{seed:1.5}}));
 for(const url of ['http://api.example.com','https://127.0.0.1','https://0x7f000001','https://[::1]','https://local.internal','https://x:secret@api.example.com','https://api.example.com?key=secret'])assert.throws(()=>profile('custom',{base_url:url}));
 assert.equal(profile('custom',{base_url:'https://api.example.com/v1/chat/completions/'}).base_url,'https://api.example.com/v1');
});
test('partial, blocked, tool or malformed outputs are never accepted as complete JSON',()=>{
 assert.throws(()=>responseJSON('chat',{choices:[{finish_reason:'length',message:{content:'{"ok":true}'}}]}));
 assert.throws(()=>responseJSON('anthropic',{stop_reason:'max_tokens',content:[]}));assert.throws(()=>responseJSON('gemini',{candidates:[{finishReason:'SAFETY'}]}));
 assert.throws(()=>responseJSON('responses',{status:'incomplete',output:[]}));
 assert.deepEqual(responseJSON('chat',{choices:[{finish_reason:'stop',message:{content:'```json\n{"ok":true}\n```'}}]}),{ok:true});
});
test('encrypted keys are bound to account and connection, survive round trip and reject tampering',async()=>{
 const encrypted=await sealKey('sample-sensitive-key','user-a','id-a',env);assert.ok(!JSON.stringify(encrypted).includes('sample-sensitive-key'));
 assert.equal(await openKey(encrypted,'user-a','id-a',env),'sample-sensitive-key');
 await assert.rejects(openKey(encrypted,'user-b','id-a',env));await assert.rejects(openKey(encrypted,'user-a','id-b',env));await assert.rejects(openKey({...encrypted,data:encrypted.data.slice(4)},'user-a','id-a',env));await assert.rejects(sealKey('key','a','b',()=>undefined));
});
test('provider transport blocks private DNS, pins checked address with correct TLS host, and rejects redirects',async()=>{
 for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.1.1','100.64.0.1','192.168.1.1','::1','::ffff:127.0.0.1','fd00::1','2002:7f00:1::'])assert.equal(publicAddress(ip),false,ip);
 for(const ip of ['93.184.215.14','2001:4860:4860::8888','2606:4700::1111'])assert.equal(publicAddress(ip),true,ip);
 let calls=0;await assert.rejects(providerJSON('https://api.example.com/v1',{headers:{}},{lookup:async()=>[{address:'10.0.0.1',family:4}],request:()=>calls++}));assert.equal(calls,0);
 const request=(options,callback)=>{calls++;assert.equal(options.hostname,'93.184.215.14');assert.equal(options.servername,'api.example.com');assert.equal(options.headers.Host,'api.example.com');assert.equal(options.rejectUnauthorized,true);const req=new EventEmitter();req.write=()=>{};req.end=()=>{const res=new EventEmitter();res.statusCode=302;res.destroy=()=>{};callback(res);};return req;};
 await assert.rejects(providerJSON('https://api.example.com/v1',{headers:{}},{lookup:async()=>[{address:'93.184.215.14',family:4}],request}),/HTTP 302/);assert.equal(calls,1);
});
function fakeAdmin(){
 const rows=new Map();const admin={auth:{getUser:async token=>({data:{user:['a','b'].includes(token)?{id:token}:null}})},from:()=>({select:()=>({eq:(_,id)=>({maybeSingle:async()=>({data:structuredClone(rows.get(id)||null)})})})}),rpc:async(name,args)=>{
  if(name==='mailbox_api_check_budget')return {data:true};
  const old=rows.get(args.p_user);if((old?.revision||0)!==args.p_revision)return {error:{code:'40001'}};
  const row={connections:args.p_connections,active_id:args.p_active,revision:args.p_revision+1};rows.set(args.p_user,structuredClone(row));return {data:{revision:row.revision}};
 }};return {admin,rows};
}
const req=(body,token='a')=>new Request('https://edge.example.com',{method:body?'POST':'GET',headers:token?{authorization:'Bearer '+token}:{},...(body?{body:JSON.stringify(body)}:{})});
test('API CRUD isolates owners, preserves encrypted keys, rotates keys and rejects stale/cross-host edits',async()=>{
 const {admin,rows}=fakeAdmin(),run=apiHandler({admin,env});
 assert.equal((await run(req(null,''))).status,401);
 let r=await run(req({action:'save',profile:profile(),key:'first-key',revision:0,activate:true}));assert.equal(r.status,200);const saved=await r.json(),id=saved.saved_id;
 const brokenDefault=apiHandler({admin,env:k=>({OPENAI_API_KEY:'legacy-key',MAILBOX_PET_MODEL:'invalid model'})[k]||env(k)});assert.equal((await brokenDefault(req(null))).status,200);
 assert.equal(saved.active_id,id);assert.equal(saved.profiles[0].has_key,true);assert.ok(!JSON.stringify(saved).includes('first-key'));assert.ok(!JSON.stringify(saved).includes('secret'));assert.ok(!JSON.stringify(rows.get('a')).includes('first-key'));
 const active=await currentConnection(admin,'a',env);assert.equal(active.key,'first-key');assert.equal(active.profile.protocol,'chat');
 assert.equal((await (await run(req(null,'b'))).json()).profiles.length,0);
 assert.equal((await run(req({action:'delete',id,revision:0},'b'))).status,404);
 assert.equal((await run(req({action:'save',id,profile:profile(),revision:0}))).status,409);
 assert.equal((await run(req({action:'save',id,profile:profile('custom',{base_url:'https://different.example.com/v1'}),revision:1}))).status,400);
 r=await run(req({action:'save',id,profile:profile('openrouter',{model:'updated'}),revision:1,activate:true}));assert.equal(r.status,200);assert.equal((await currentConnection(admin,'a',env)).key,'first-key');
 r=await run(req({action:'save',id,profile:profile(),key:'replacement',revision:2}));assert.equal(r.status,200);assert.equal((await currentConnection(admin,'a',env)).key,'replacement');
 r=await run(req({action:'delete',id,revision:3}));assert.equal(r.status,200);assert.equal((await r.json()).active_id,null);assert.equal(rows.get('a').connections.length,0);
});
test('connection test uses only synthetic text and never needs or returns room messages or credentials',async()=>{
 const {admin}=fakeAdmin();let calls=0;const run=apiHandler({admin,env,call:async(p,key,task)=>{calls++;assert.equal(key,'test-only');assert.deepEqual(task,probeTask);assert.ok(!JSON.stringify(task).includes('PRIVATE MESSAGE'));return {ok:true};}});
 const r=await run(req({action:'test',profile:profile(),revision:0,key:'test-only',context:'PRIVATE MESSAGE',user:'b'}));assert.equal(r.status,200);assert.equal((await r.json()).ok,true);assert.equal(calls,1);
});
test('pet refuses stale settings after the model responds and passes provider scope into both database gates',async()=>{
 const pet={name:'光',mood:'calm',line:'海边',traits:[],memories:[{text:'海边',sources:['1']}]},p=profile();let n=0,finish=0;
 const admin={auth:{getUser:async()=>({data:{user:{id:'a'}}})},rpc:async(name,args)=>{assert.equal(args.p_user,'a');assert.equal(args.p_scope,'https://openrouter.ai');if(name==='mailbox_pet_prepare')return {data:{context:[{id:'1',text:'海边'}],request:'r'}};finish++;return {data:{data:args.p_data}};}};
 const run=petHandler({admin,env,connection:async()=>({profile:p,key:'test',revision:++n}),call:async()=>pet});
 assert.equal((await run(req({room:'v2_testroom'}))).status,409);assert.equal(finish,0);
});
