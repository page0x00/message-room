import assert from 'node:assert/strict';
export async function runDailyDatabase({db,check,as,denied,scalar,a,b,c,room}){
 const roomId=room.room_id,id=()=>crypto.randomUUID();
 const add=async(kind,data={},visibility='shared',owner=a)=>{const key=id();return (await db.query("insert into space_entries(id,room_id,owner_user_id,kind,visibility,title,event_date,data) values($1,$2,$3,$4,$5,'record',current_date,$6) returning *",[key,roomId,owner,kind,visibility,JSON.stringify(data)])).rows[0];};
 let diary,privatePath,sharedPath;
 await check('daily records and media enforce UUID ownership and private visibility',async()=>{
  await as(a);privatePath=`${roomId}/${a}/${id()}`;sharedPath=`${roomId}/${a}/${id()}`;
  for(const path of [privatePath,sharedPath])await db.query("insert into storage.objects(bucket_id,name,metadata) values('message-media',$1,'{\"size\":12,\"mimetype\":\"image/png\"}')",[path]);
  diary=await add('diary',{media:[{path:privatePath,mime:'image/png',size:12}]},'private');await add('diary',{media:[{path:sharedPath,mime:'image/png',size:12}]});
  await as(b);assert.equal(await scalar('select count(*) from space_entries where id=$1',[diary.id]),0);assert.equal(await scalar('select count(*) from storage.objects where name=$1',[privatePath]),0);assert.equal(await scalar('select count(*) from storage.objects where name=$1',[sharedPath]),1);
  await denied("insert into space_entries(id,room_id,owner_user_id,kind) values($1,$2,$3,'diary')",[id(),roomId,a]);
  await as(c);assert.equal(await scalar('select count(*) from space_entries'),0);assert.equal(await scalar('select count(*) from storage.objects where name=$1',[sharedPath]),0);
  await as(a);assert.equal((await db.query('delete from storage.objects where name=$1 returning id',[privatePath])).rows.length,0);
 });
 await check('daily edits reject stale revisions and prevent changing the record origin',async()=>{
  await as(a);await db.query("update space_entries set body='new',revision=2 where id=$1",[diary.id]);
  await denied("update space_entries set body='stale',revision=2 where id=$1",[diary.id],'40001');
  await denied('update space_entries set owner_user_id=$2,revision=3 where id=$1',[diary.id,b]);
  await as(b);assert.equal((await db.query("update space_entries set body='other',revision=3 where id=$1 returning id",[diary.id])).rows.length,0);
 });
 await check('shared goals accept separate daily check-ins while rejecting duplicates and unrelated goals',async()=>{
  await as(a);const goal=await add('goal');await add('checkin',{goal:goal.id});
  await denied("insert into space_entries(id,room_id,owner_user_id,kind,event_date,data) values($1,$2,$3,'checkin',current_date,$4)",[id(),roomId,a,JSON.stringify({goal:goal.id})],'23505');
  await as(b);await add('checkin',{goal:goal.id},'shared',b);
  await denied("insert into space_entries(id,room_id,owner_user_id,kind,data) values($1,$2,$3,'checkin',$4)",[id(),roomId,b,JSON.stringify({goal:id()})],'22023');
 });
 let pocket,deposit,withdraw;
 await check('pocket creation requires a private uploaded QR and is idempotent',async()=>{
  await as(a);pocket=id();const args=[pocket,roomId,sharedPath];const sql="select mailbox_create_pocket($1,$2,'旅行',10000,500,'daily',null,'',$3,null)";
  await db.query(sql,args);await db.query(sql,args);assert.equal(await scalar('select count(*) from pockets where id=$1',[pocket]),1);
  await denied("insert into pockets(id,room_id,owner_user_id,title,target_cents,mode,qr_path) values($1,$2,$3,'forged',100,'free',$4)",[id(),roomId,a,sharedPath]);
  await as(c);assert.equal(await scalar('select count(*) from pockets'),0);await denied("select mailbox_pocket_action($1,$2,'deposit',100,'')",[pocket,id()]);
 });
 await check('pocket deposits retry exactly once and reject forged direct writes',async()=>{
  await as(a);deposit=id();const sql="select mailbox_pocket_action($1,$2,'deposit',5000,'第一次')";await db.query(sql,[pocket,deposit]);await db.query(sql,[pocket,deposit]);assert.equal(await scalar('select count(*) from pocket_entries where id=$1',[deposit]),1);
  await denied("select mailbox_pocket_action($1,$2,'deposit',9999,'改金额')",[pocket,deposit],'22023');
  await denied("insert into pocket_entries(id,pocket_id,room_id,owner_user_id,kind,cents,status) values($1,$2,$3,$4,'deposit',9999999,'settled')",[id(),pocket,roomId,a]);
  await as(b);await denied("select mailbox_pocket_action($1,$2,'deposit',5000,'第一次')",[pocket,deposit]);
 });
 await check('nonurgent withdrawals use server cooling time and explicit second confirmation',async()=>{
  await as(a);withdraw=id();await db.query("select mailbox_pocket_action($1,$2,'withdraw',2000,'电脑',48,false)",[pocket,withdraw]);
  assert.equal(await scalar('select status from pocket_entries where id=$1',[withdraw]),'pending');assert.ok(await scalar("select available_at>now()+interval '47 hours' from pocket_entries where id=$1",[withdraw]));
  await denied("select mailbox_pocket_action($1,$2,'confirm')",[pocket,withdraw],'22023');
  await denied("update pocket_entries set available_at=now()-interval '1 day' where id=$1",[withdraw]);
  await as(b);await denied("select mailbox_pocket_action($1,$2,'confirm')",[pocket,withdraw]);
  await db.exec('reset role');await db.query("update pocket_entries set available_at=now()-interval '1 second' where id=$1",[withdraw]);
  await as(a);await db.query("select mailbox_pocket_action($1,$2,'confirm')",[pocket,withdraw]);await db.query("select mailbox_pocket_action($1,$2,'confirm')",[pocket,withdraw]);assert.equal(await scalar('select status from pocket_entries where id=$1',[withdraw]),'settled');
 });
 await check('emergency withdrawals need a reason; balance cannot be overdrawn; cancellation is final',async()=>{
  await as(a);await denied("select mailbox_pocket_action($1,$2,'withdraw',100,'',24,true)",[pocket,id()],'22023');await denied("select mailbox_pocket_action($1,$2,'withdraw',99999,'大额',24,true)",[pocket,id()],'22023');
  const emergency=id();await db.query("select mailbox_pocket_action($1,$2,'withdraw',100,'紧急',24,true)",[pocket,emergency]);assert.equal(await scalar('select status from pocket_entries where id=$1',[emergency]),'settled');
  const cancel=id();await db.query("select mailbox_pocket_action($1,$2,'withdraw',200,'再想想')",[pocket,cancel]);await db.query("select mailbox_pocket_action($1,$2,'cancel')",[pocket,cancel]);await denied("select mailbox_pocket_action($1,$2,'confirm')",[pocket,cancel],'22023');
 });
 await check('pocket leave preserves the author, dates and reason and deduplicates retries',async()=>{
  await as(b);const leave=id(),args=[pocket,leave];const q="select mailbox_pocket_leave($1,$2,current_date,current_date+2,'休息几天')";await db.query(q,args);await db.query(q,args);assert.equal(await scalar('select owner_user_id from pocket_leaves where id=$1',[leave]),b);await as(a);await denied(q,args,'22023');
 });
 await db.exec('reset role');
}
