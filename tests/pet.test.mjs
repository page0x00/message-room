import test from 'node:test';
import assert from 'node:assert/strict';
import {modelRequest,parsePet} from '../supabase/functions/mailbox-pet/policy.mjs';
const context=[{id:'17',author:'user',text:'明天一起看海。'}];
const response=v=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(v)}]}]});
test('model request separates untrusted chat data, disables storage and has no callable tools',()=>{
 const r=modelRequest('configured-model',context);assert.equal(r.store,false);assert.equal(r.model,'configured-model');assert.equal(r.tools,undefined);assert.equal(r.text.format.strict,true);assert.deepEqual(JSON.parse(r.input[0].content),context);
});
test('pet refuses fabricated source IDs, refusals and incomplete responses',()=>{
 const value={name:'小光',mood:'curious',line:'记住去看海的约定。',traits:['好奇'],memories:[{text:'约好一起看海。',sources:['17']}]};
 assert.equal(parsePet(response(value),context).memories.length,1);assert.throws(()=>parsePet(response({...value,memories:[{text:'invented',sources:['secret'] }]}),context));assert.throws(()=>parsePet({status:'incomplete'},context));assert.throws(()=>parsePet({status:'completed',output:[{content:[{type:'refusal',refusal:'no'}]}]},context));
});
