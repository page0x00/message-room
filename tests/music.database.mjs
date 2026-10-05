import assert from 'node:assert/strict';
export async function runMusicDatabase({db,check,as,denied,scalar,a,b,c,room}){
 const key='b'.repeat(64),other='c'.repeat(64),pid=crypto.randomUUID();
 await check('music metadata stays private until explicitly shared; likes are independent UUID records',async()=>{
  await as(a);await db.query("insert into music_tracks(room_id,owner_user_id,track_key,title) values($1,$2,$3,'private song')",[room.room_id,a,key]);
  await as(b);assert.equal(await scalar('select count(*) from music_tracks where track_key=$1',[key]),0);
  await denied('insert into music_likes values($1,$2,$3,now())',[room.room_id,b,key],'22023');
  await as(a);await db.query("update music_tracks set visibility='shared' where track_key=$1",[key]);await db.query('insert into music_likes(room_id,owner_user_id,track_key) values($1,$2,$3)',[room.room_id,a,key]);
  await as(b);await db.query('insert into music_likes(room_id,owner_user_id,track_key) values($1,$2,$3)',[room.room_id,b,key]);
  assert.equal(await scalar('select count(*) from music_likes where track_key=$1',[key]),2);
  assert.equal((await db.query('delete from music_likes where owner_user_id=$1 returning *',[a])).rows.length,0);
  await denied('insert into music_colors values($1,$2,$3)',[room.room_id,a,'#aabbcc']);
 });
 await check('private playlists are hidden, shared playlists permit peer ordering and reject stale or private additions',async()=>{
  await as(a);await db.query("insert into music_tracks(room_id,owner_user_id,track_key,title) values($1,$2,$3,'hidden song')",[room.room_id,a,other]);
  await db.query("insert into music_playlists(id,room_id,owner_user_id,title,visibility,track_keys) values($1,$2,$3,'shared','shared',$4)",[pid,room.room_id,a,[key]]);
  await db.query("insert into music_playlists(id,room_id,owner_user_id,title,visibility,track_keys) values(gen_random_uuid(),$1,$2,'private','private',$3)",[room.room_id,a,[other]]);
  await as(b);assert.equal(await scalar('select count(*) from music_playlists where room_id=$1',[room.room_id]),1);
  await db.query("update music_playlists set title='our list',revision=2 where id=$1",[pid]);
  await denied('update music_playlists set revision=2 where id=$1',[pid],'40001');
  await denied('update music_playlists set track_keys=$2,revision=3 where id=$1',[pid,[key,other]],'22023');
  await denied('update music_playlists set owner_user_id=$2,revision=3 where id=$1',[pid,b]);
  await as(c);assert.equal(await scalar('select count(*) from music_playlists'),0);await denied('select mailbox_listen_report($1,current_date,current_date)',[room.room_id]);
 });
 await check('heartbeats use server elapsed time and actual progress, reject solo inflation and direct writes',async()=>{
  await as(a);await denied("insert into listen_spans(room_id,user_id,track_key,started_at,ended_at) values($1,$2,$3,now()-interval '1 day',now())",[room.room_id,a,key]);
  await db.exec('reset role');await db.query("update listen_sessions set track_key=$2,is_playing=true,position_seconds=0,updated_at=clock_timestamp()-interval '10 seconds' where room_id=$1",[room.room_id,key]);
  await db.query("insert into listen_presence values($1,$2,$3,5,true,clock_timestamp()-interval '5 seconds',null) on conflict(room_id,user_id) do update set track_key=excluded.track_key,position_seconds=5,playing=true,seen_at=excluded.seen_at,span_id=null",[room.room_id,a,key]);
  await as(a);await scalar('select mailbox_listen_heartbeat($1,$2,10,true)',[room.room_id,key]);
  const report=await scalar('select mailbox_listen_report($1,current_date,current_date)',[room.room_id]);assert.equal(report.total_seconds,0);
  await db.exec('reset role');assert.equal(await scalar('select count(*) from listen_spans where room_id=$1',[room.room_id]),1);
  await db.query("update listen_presence set seen_at=clock_timestamp()-interval '5 seconds' where room_id=$1",[room.room_id]);await as(a);await scalar('select mailbox_listen_heartbeat($1,$2,10,true)',[room.room_id,key]);
  await db.exec('reset role');assert.equal(await scalar('select span_id is null from listen_presence where room_id=$1 and user_id=$2',[room.room_id,a]),true);
 });
 await check('reports intersect different users, union overlaps and split exact seconds at Shanghai midnight',async()=>{
  await db.exec('reset role');const ids=[a,b,c],playId=crypto.randomUUID();for(const [i,id] of ids.entries())await db.query("insert into listen_spans(room_id,user_id,track_key,started_at,ended_at,play_id) values($1,$2,$3,$4,$5,$6)",[room.room_id,id,other,i===0?'2026-09-16T15:59:50Z':'2026-09-16T15:59:55Z','2026-09-16T16:00:10Z',playId]);
  await as(a);const r=await scalar("select mailbox_listen_report($1,'2026-09-16','2026-09-17')",[room.room_id]);
  assert.equal(r.total_seconds,15);assert.deepEqual(r.daily.map(d=>[d.day,d.seconds]),[['2026-09-16',5],['2026-09-17',10]]);assert.equal(r.tracks[0].plays,1);
  await as();await denied("select mailbox_listen_report($1,'2026-09-16','2026-09-17')",[room.room_id]);await db.exec('reset role');
 });
}
