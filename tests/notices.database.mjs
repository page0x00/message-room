import assert from 'node:assert/strict';
export async function runNoticeDatabase({db,check,as,denied,scalar,a,b,c,room}){
 const rid=room.room_id,goal=crypto.randomUUID(),todo=crypto.randomUUID(),event=crypto.randomUUID();let notice;
 await check('reminders use real due records, stay user-private, deduplicate, and disappear after completion',async()=>{
  await as(a);await db.query("insert into space_entries(id,room_id,owner_user_id,kind,title,event_date,data) values($1,$2,$3,'goal','new due goal',(now() at time zone 'Asia/Shanghai')::date,'{\"remind\":true}')",[goal,rid,a]);
  await db.query("insert into space_entries(id,room_id,owner_user_id,kind,visibility,title,event_date,data) values($1,$2,$3,'todo','private','private title',(now() at time zone 'Asia/Shanghai')::date,'{\"remind\":true}')",[todo,rid,a]);
  await db.query("insert into anniversaries(id,room_id,owner_user_id,title,event_date,remind) values($1,$2,$3,'today',(now() at time zone 'Asia/Shanghai')::date,true)",[event,rid,a]);
  const first=await scalar('select mailbox_sync_notices($1)',[rid]);notice=first.find(n=>n.source_id===goal);assert.ok(notice);assert.ok(first.some(n=>n.source_id===todo));assert.ok(first.some(n=>n.source_id===event));assert.equal(JSON.stringify(first).includes('private title'),false);
  const again=await scalar('select mailbox_sync_notices($1)',[rid]);assert.equal(again.find(n=>n.source_id===goal).id,notice.id);
  await db.query("insert into space_entries(id,room_id,owner_user_id,kind,event_date,data) values(gen_random_uuid(),$1,$2,'checkin',(now() at time zone 'Asia/Shanghai')::date,$3)",[rid,a,{goal}]);
  assert.equal((await scalar('select mailbox_sync_notices($1)',[rid])).some(n=>n.source_id===goal),false);
  await as(b);assert.equal(await scalar('select count(*) from relation_notices where id=$1',[notice.id]),0);assert.equal((await scalar('select mailbox_sync_notices($1)',[rid])).some(n=>n.source_id===todo),false);
  await as(c);await denied('select mailbox_sync_notices($1)',[rid]);await as(a);await denied('select mailbox_push_jobs()');await denied("insert into relation_notices(room_id,user_id,kind,source_id,dedupe,expires_at) values($1,$2,'listen','fake','fake',now())",[rid,b]);
 });
 await check('listen invitations require current session owner and queue only peer recipients once',async()=>{
  await db.exec('reset role');await db.query('update listen_sessions set updated_by=$2,updated_at=clock_timestamp(),play_id=gen_random_uuid() where room_id=$1',[rid,b]);
  await as(a);await denied('select mailbox_invite_listen($1)',[rid]);await as(b);assert.ok(await scalar('select mailbox_invite_listen($1)',[rid])>0);assert.equal(await scalar('select mailbox_invite_listen($1)',[rid]),0);
  await as(a);const ns=await scalar('select mailbox_sync_notices($1)',[rid]);notice=ns.find(n=>n.kind==='listen');assert.ok(notice);await scalar('select mailbox_read_notice($1,$2)',[rid,notice.id]);assert.ok((await scalar('select mailbox_sync_notices($1)',[rid])).find(n=>n.id===notice.id).seen_at);
 });
 await check('scheduled push jobs include only valid member subscriptions, no private content, and no completed reminders',async()=>{
  await as(a);await db.query("insert into push_subscriptions(room_id,user_id,endpoint,p256dh,auth) values($1,$2,'https://fcm.googleapis.com/test-notices',$3,$4) on conflict do nothing",[rid,a,'a'.repeat(87),'b'.repeat(22)]);
  await db.exec('reset role');const jobs=await scalar('select mailbox_push_jobs()');assert.ok(Array.isArray(jobs));assert.ok(jobs.length);assert.ok(!JSON.stringify(jobs).includes('private title'));assert.equal(jobs.some(j=>j.source_id===notice.id),false);
  for(const job of jobs)assert.ok(['message','goal','todo','anniversary','pocket','withdraw','listen'].includes(job.kind));
 });
 await db.exec('reset role');
}
