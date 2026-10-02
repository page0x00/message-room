import assert from 'node:assert/strict';
export async function runPetDatabase({db,check,as,denied,scalar,a,b,c,room}){
 const rid=room.room_id;
 await check('pet reads only consenting authors and normal text, never private diaries, imports or other rooms',async()=>{
  await as(a);await scalar("select mailbox_pet_consent($1,true,false,'2026-01-01',null)",[rid]);
  await denied('select mailbox_pet_prepare($1,$2)',[rid,a]);
  await denied("insert into pet_states values($1,$2,'{}',1,'fake',1,now())",[rid,a]);
  await db.query("insert into messages(room_id,author_id,sender,content,message_type,client_nonce) values($1,$2::uuid,$2::text,'a normal memory','text',gen_random_uuid())",[rid,a]);
  await as(b);await db.query("insert into messages(room_id,author_id,sender,content,message_type,client_nonce) values($1,$2::uuid,$2::text,'not consented secret','text',gen_random_uuid())",[rid,b]);
  await as(c);assert.equal(await scalar('select count(*) from pet_consents where room_id=$1',[rid]),0);await denied("select mailbox_pet_consent($1,true,true,'2026-01-01',null)",[rid]);
  await db.exec('reset role');const prep=await scalar('select mailbox_pet_prepare($1,$2)',[rid,a]);assert.ok(prep.context.length>0);assert.ok(prep.context.every(m=>m.author===a));assert.ok(!JSON.stringify(prep).includes('not consented secret'));
  const result={name:'小光',mood:'happy',line:'记得最近的晚风。',traits:['好奇'],memories:[{text:'a normal memory',sources:[prep.context.at(-1).id]}]};
  await scalar('select mailbox_pet_finish($1,$2,$3,$4)',[rid,a,prep.request,result]);
  await as(b);assert.equal(await scalar('select count(*) from pet_states where room_id=$1',[rid]),0);
  await as(a);assert.equal(await scalar('select count(*) from pet_states where room_id=$1',[rid]),1);
  await db.exec('reset role');assert.equal((await scalar('select mailbox_pet_prepare($1,$2)',[rid,a])).cached,true);
 });
 await check('revoking chat consent clears derivatives and invalidates in-flight results; request budget cannot reset by toggling',async()=>{
  await as(b);await scalar("select mailbox_pet_consent($1,true,true,'2026-01-01',null)",[rid]);
  await db.exec('reset role');assert.equal(await scalar('select count(*) from pet_states where room_id=$1',[rid]),0);
  const prep=await scalar('select mailbox_pet_prepare($1,$2)',[rid,b]);assert.ok(prep.context.some(m=>m.author===a));assert.ok(prep.context.some(m=>m.author===b));
  await as(a);await scalar("select mailbox_pet_consent($1,false,false,'2026-01-01',null)",[rid]);
  await db.exec('reset role');await denied('select mailbox_pet_finish($1,$2,$3,$4)',[rid,b,prep.request,{name:'stale'}],'40001');
  await denied('select mailbox_pet_prepare($1,$2)',[rid,b],'P0001');
  await denied('select mailbox_pet_prepare($1,$2)',[rid,a]);
 });
 await db.exec('reset role');
}
