import assert from 'node:assert/strict';
export async function runMemoryDatabase({db,check,as,denied,scalar,a,b,room}){
 await check('memory layouts and films stay private across room members and revisions reject lost updates',async()=>{
  await as(a);await db.query('insert into memory_profiles(room_id,owner_user_id,data) values($1,$2,$3)',[room.room_id,a,{view:'board',annotations:{'message:1':{back:'private note'}}}]);
  const id=crypto.randomUUID();await db.query("insert into memory_films(id,room_id,owner_user_id,title,frames) values($1,$2,$3,'our film',$4)",[id,room.room_id,a,[{source:'message:1',seconds:4}]]);
  await as(b);assert.equal(await scalar('select count(*) from memory_profiles where room_id=$1',[room.room_id]),0);assert.equal(await scalar('select count(*) from memory_films where room_id=$1',[room.room_id]),0);assert.equal((await db.query("update memory_films set title='stolen',revision=2 where id=$1 returning id",[id])).rows.length,0);
  await as(a);await db.query("update memory_films set title='revised',revision=2 where id=$1",[id]);await denied('update memory_films set revision=2 where id=$1',[id],'40001');await denied('update memory_profiles set owner_user_id=$2,revision=2 where room_id=$1',[room.room_id,b]);
  await denied('update memory_films set frames=$2,revision=3 where id=$1',[id,[{source:'https://evil.test',seconds:4}]],'22023');await denied('update memory_films set frames=$2,revision=3 where id=$1',[id,[{source:'message:1',seconds:0}]],'22023');await db.exec('reset role');
 });
}
