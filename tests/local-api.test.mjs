import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalConnections,directModel,directModels,localFingerprint} from '../local-api.js';
import {generateDirectPet} from '../direct-pet.js';
import {providers,normalizeProfile,probeTask} from '../supabase/functions/_shared/ai-providers.js';
const profile=(id='openrouter',extra={})=>normalizeProfile({...providers.find(p=>p.id===id),provider:id,name:'本机连接',model:'test-model',...extra});
const memory=()=>{const entries=new Map();return {entries,getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,v),removeItem:k=>entries.delete(k)};};
const stores=()=>{const session=memory(),persistent=memory();return {session,persistent,store:createLocalConnections({session:()=>session,persistent:()=>persistent})};};
test('local credentials default to this tab, persist only after opt-in and never appear in metadata views',()=>{
 const {store,session,persistent}=stores();assert.equal(store.mode('a'),null);
 const saved=store.change('a',{action:'save',profile:profile(),key:'local-secret',revision:0});assert.equal(store.active('a').key,'local-secret');assert.ok(!JSON.stringify(saved).includes('local-secret'));assert.ok(!JSON.stringify([...persistent.entries]).includes('local-secret'));assert.ok(JSON.stringify([...session.entries]).includes('local-secret'));assert.equal(store.active('b'),null);
 assert.throws(()=>store.change('a',{action:'save',id:saved.saved_id,profile:profile(),revision:0}));
 store.change('a',{action:'save',id:saved.saved_id,profile:profile(),revision:1,remember:true});assert.ok(JSON.stringify([...persistent.entries]).includes('local-secret'));assert.ok(!JSON.stringify([...session.entries]).includes('local-secret'));
 store.change('a',{action:'save',id:saved.saved_id,profile:profile(),revision:2,remember:false});assert.ok(!JSON.stringify([...persistent.entries]).includes('local-secret'));store.clearSession('a');assert.equal(store.active('a'),null);
});
test('host changes require a fresh key, deleting/clearing removes credentials and cloud selection does not upload local profiles',()=>{
 const {store,session,persistent}=stores();const a=store.change('a',{action:'save',profile:profile(),key:'one-key',revision:0,remember:true});
 assert.throws(()=>store.credential('a',a.saved_id,profile('custom',{base_url:'https://new.example.com/v1'}),''),/域名/);
 store.choose('a','cloud');assert.equal(store.active('a'),null);store.choose('a','local');assert.equal(store.active('a').key,'one-key');
 store.change('a',{action:'delete',id:a.saved_id,revision:1});assert.ok(!JSON.stringify([...session.entries,...persistent.entries]).includes('one-key'));
 store.change('a',{action:'save',profile:profile(),key:'another-key',revision:2,remember:true});store.clear('a');assert.ok(!JSON.stringify([...session.entries,...persistent.entries]).includes('another-key'));assert.equal(store.mode('a'),'local');assert.equal(store.active('a'),null);
});
test('direct calls send credentials only to the chosen URL, preserve exclusions and opt in to Anthropic browser support',async()=>{
 const fixtures={responses:{status:'completed',output:[{content:[{type:'output_text',text:'{"ok":true}'}]}]},chat:{choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}]},anthropic:{stop_reason:'end_turn',content:[{type:'text',text:'{"ok":true}'}]},gemini:{candidates:[{finishReason:'STOP',content:{parts:[{text:'{"ok":true}'}]}}]}};
 for(const id of ['openrouter','openai','anthropic','gemini']){
  const p=profile(id,{params:{temperature:0},exclude:[id==='gemini'?'generationConfig.temperature':'temperature']});let count=0;
  assert.deepEqual(await directModel(p,'only-provider-key',probeTask,{fetcher:async(url,options)=>{count++;assert.equal(new URL(url).origin,new URL(p.base_url).origin);assert.equal(options.mode,'cors');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert.ok(!options.body.includes('only-provider-key'));assert.ok(!options.body.includes('temperature'));if(id==='anthropic')assert.equal(options.headers['anthropic-dangerous-direct-browser-access'],'true');return Response.json(fixtures[p.protocol]);}}),{ok:true});assert.equal(count,1);
 }
 const models=await directModels(profile(), 'model-key',{fetcher:async(url,options)=>{assert.ok(url.endsWith('/models'));assert.equal(options.body,undefined);return Response.json({data:[{id:'a'},{id:'a'},{id:'b'}]});}});assert.deepEqual(models,['a','b']);
});
test('CORS and upstream errors are explained without leaking raw responses or automatically using a proxy',async()=>{
 let count=0;await assert.rejects(directModel(profile(),'private-key',probeTask,{fetcher:async()=>{count++;throw new TypeError('Failed to fetch');}}),/CORS/);assert.equal(count,1);
 await assert.rejects(directModel(profile(),'private-key',probeTask,{fetcher:async()=>new Response('echo private-key',{status:401})}),e=>!e.message.includes('private-key')&&e.message.includes('密钥'));
 await assert.rejects(directModel(profile(),'private-key',probeTask,{fetcher:async()=>Response.json({choices:[{finish_reason:'stop',message:{content:'not JSON: private-key'}}]})}),e=>!e.message.includes('private-key')&&e.message.includes('JSON'));
});
test('direct pet uses only server-authorized context and saves validated output without passing key or profile to Supabase',async()=>{
 const {store}=stores();store.change('a',{action:'save',profile:profile(),key:'private-key',revision:0});const calls=[];
 const pet={name:'光',mood:'calm',line:'海边',traits:['好奇'],memories:[{text:'海边',sources:['1']}]};
 const sb={rpc:(name,args)=>({abortSignal:async()=>{calls.push({name,args});assert.ok(!JSON.stringify(args).includes('private-key'));assert.ok(!JSON.stringify(args).includes('test-model'));assert.match(args.p_config,/^[a-f0-9]{64}$/);assert.equal(args.p_scope,'https://openrouter.ai');return {data:name.endsWith('prepare_direct')?{context:[{id:'1',text:'only authorized text'}],request:'r'}:{data:args.p_data}};}})};
 const result=await generateDirectPet({sb,user:'a',room:'v2_room',connections:store,call:async(p,key,task)=>{assert.equal(key,'private-key');assert.deepEqual(JSON.parse(task.input),[{id:'1',text:'only authorized text'}]);return pet;}});
 assert.equal(calls.length,2);assert.deepEqual(result.state.data,pet);assert.ok(!(await localFingerprint(store.active('a'))).includes('private-key'));
});
test('direct pet rejects unauthorized scopes, fabricated sources, cancelled requests and settings changed during generation',async()=>{
 const {store}=stores();store.change('a',{action:'save',profile:profile(),key:'private-key',revision:0});let calls=0,finished=0;
 const sb={rpc:name=>({abortSignal:async()=>{if(name.endsWith('finish_direct'))finished++;return {data:{context:[{id:'1',text:'海边'}],request:'r'}};}})};
 const bad={rpc:()=>({abortSignal:async()=>({error:{code:'42501'}})})};await assert.rejects(generateDirectPet({sb:bad,user:'a',room:'v2_room',connections:store,call:async()=>calls++}));assert.equal(calls,0);
 const pet={name:'光',mood:'calm',line:'海边',traits:[],memories:[{text:'海边',sources:['wrong']}]};await assert.rejects(generateDirectPet({sb,user:'a',room:'v2_room',connections:store,call:async()=>pet}));assert.equal(finished,0);
 pet.memories[0].sources=['1'];await assert.rejects(generateDirectPet({sb,user:'a',room:'v2_room',connections:store,call:async()=>{store.choose('a','cloud');return pet;}}),/配置已变化/);assert.equal(finished,0);
 store.choose('a','local');const controller=new AbortController();controller.abort();await assert.rejects(generateDirectPet({sb,user:'a',room:'v2_room',connections:store,signal:controller.signal}),e=>e.name==='AbortError');
});
