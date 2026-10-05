import assert from 'node:assert/strict';
export async function runAPIDatabase({db,check,as,denied,scalar,a,b,room}){
 await check('encrypted API settings and write RPC are inaccessible to browser roles; writes are atomic and revision checked',async()=>{
  const id=crypto.randomUUID(),connections=[{id,name:'test',secret:{v:1,iv:'cipher-iv',data:'ciphertext'}}];
  await as(a);await denied('select * from mailbox_api_settings');await denied("insert into mailbox_api_settings(user_id) values($1)",[a]);await denied('select mailbox_api_save($1,$2,$3,0)',[a,connections,id]);await denied('select mailbox_api_check_budget($1)',[a]);
  await as();await denied('select * from mailbox_api_settings');
  await db.exec('reset role; set role service_role');
  assert.equal((await scalar('select mailbox_api_save($1,$2,$3,0)',[a,connections,id])).revision,1);
  await denied('select mailbox_api_save($1,$2,$3,0)',[a,[],null],'40001');
  await denied('select mailbox_api_save($1,$2,$3,1)',[a,[],id],'22023');
  assert.equal(await scalar('select mailbox_api_check_budget($1)',[a]),true);await denied('select mailbox_api_check_budget($1)',[a],'P0001');
  await db.exec('reset role');assert.equal(await scalar('select active_id from mailbox_api_settings where user_id=$1',[a]),id);
  await as(b);await denied('select * from mailbox_api_settings');await db.exec('reset role');
 });
 await check('new API hosts require fresh author consent and mixed-provider chat scopes stay isolated',async()=>{
  const rid=room.room_id,scope='https://openrouter.ai';
  await as(a);await scalar("select mailbox_pet_consent($1,true,false,'2026-01-01',null,$2)",[rid,scope]);
  await as(b);await scalar("select mailbox_pet_consent($1,true,false,'2026-01-01',null)",[rid]);
  await db.exec('reset role');await db.query("update mailbox_private.pet_jobs set last_attempt=null,attempts=0 where room_id=$1",[rid]);
  await denied('select mailbox_pet_prepare($1,$2,$3)',[rid,a,'https://api.openai.com']);
  const p=await scalar('select mailbox_pet_prepare($1,$2,$3,$4)',[rid,a,scope,'config-1']);assert.ok(p.context.length);assert.ok(p.context.every(m=>m.author===a));
  await denied('select mailbox_pet_finish($1,$2,$3,$4,$5,$6)',[rid,a,p.request,{name:'test'},scope,'config-2'],'40001');
  await as(a);await scalar("select mailbox_pet_consent($1,false,false,'2026-01-01',null,$2)",[rid,scope]);await db.exec('reset role');
  await denied('select mailbox_pet_finish($1,$2,$3,$4,$5,$6)',[rid,a,p.request,{name:'test'},scope,'config-1'],'40001');
 });
 await check('browser direct RPCs preserve ownership, author consent and source validation without storing API keys',async()=>{
  const rid=room.room_id,scope='https://openrouter.ai',config='a'.repeat(64);
  await as();await denied('select mailbox_pet_prepare_direct($1,$2,$3)',[rid,scope,config]);
  await as(a);await scalar("select mailbox_pet_consent($1,true,false,'2026-01-01',null,$2)",[rid,scope]);
  await db.exec('reset role');await db.query('update mailbox_private.pet_jobs set last_attempt=null,attempts=0 where room_id=$1',[rid]);
  await as(a);await denied('select mailbox_pet_prepare_direct($1,$2,$3)',[rid,'https://api.openai.com',config]);
  const prepared=await scalar('select mailbox_pet_prepare_direct($1,$2,$3)',[rid,scope,config]);assert.ok(prepared.context.length);assert.ok(prepared.context.every(m=>m.author===a));
  const pet={name:'光',mood:'calm',line:'记得日常。',traits:['好奇'],memories:[{text:'日常',sources:['fabricated']} ]};
  const args=[rid,scope,config,prepared.request,pet];await denied('select mailbox_pet_finish_direct($1,$2,$3,$4,$5)',args,'22023');
  pet.memories[0].sources=[prepared.context[0].id];
  await as(b);await denied('select mailbox_pet_finish_direct($1,$2,$3,$4,$5)',args,'40001');
  await as(a);const saved=await scalar('select mailbox_pet_finish_direct($1,$2,$3,$4,$5)',args);assert.equal(saved.owner_user_id,a);assert.deepEqual(saved.data,pet);
  assert.equal((await scalar('select mailbox_pet_prepare_direct($1,$2,$3)',[rid,scope,config])).cached,true);
  await as(b);assert.equal(await scalar('select count(*) from pet_states where room_id=$1',[rid]),0);
  await db.exec('reset role');
 });
 await check('browser direct output cannot be saved after consent is revoked',async()=>{
  const rid=room.room_id,scope='https://openrouter.ai',config='b'.repeat(64);
  await db.exec('reset role');await db.query('update mailbox_private.pet_jobs set last_attempt=null,attempts=0 where room_id=$1',[rid]);
  await as(a);const prepared=await scalar('select mailbox_pet_prepare_direct($1,$2,$3)',[rid,scope,config]);
  await scalar("select mailbox_pet_consent($1,false,false,'2026-01-01',null,$2)",[rid,scope]);
  await denied('select mailbox_pet_finish_direct($1,$2,$3,$4,$5)',[rid,scope,config,prepared.request,{name:'光',mood:'calm',line:'日常',traits:[],memories:[]}],'40001');
  await db.exec('reset role');
 });
}
