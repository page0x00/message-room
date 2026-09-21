import { client, loadMessages } from './backend.js?v=2.3.0';
import { mediaPathValid } from './feature-core.js?v=2.3.0';

function take(result){if(result.error)throw result.error;return result.data;}
export async function roomDetails(room){return take(await client(true).from('mailbox_rooms').select('room_id,created_at,relationship_since').eq('room_id',room).single());}
export async function setRelationship(room,date){return take(await client(true).from('mailbox_rooms').update({relationship_since:date||null}).eq('room_id',room).select('relationship_since').single());}
export async function events(room){return take(await client(true).from('anniversaries').select('*').eq('room_id',room).order('event_date').limit(500))||[];}
export async function saveEvent(row){
  const {data,error}=await client(true).from('anniversaries').insert(row).select().single();
  if(error?.code==='23505')return take(await client(true).from('anniversaries').select('*').eq('id',row.id).single());
  return take({data,error});
}
export async function deleteEvent(room,id){return take(await client(true).from('anniversaries').delete().eq('room_id',room).eq('id',id).select('id'));}
export async function updateEvent(row){return take(await client(true).from('anniversaries').update({title:row.title,event_date:row.event_date,repeat_yearly:row.repeat_yearly}).eq('room_id',row.room_id).eq('id',row.id).select().single());}
export async function listMemoirs(room){return take(await client(true).from('memoirs').select('id,title,range_start,range_end,updated_at,revision').eq('room_id',room).order('updated_at',{ascending:false}).limit(100))||[];}
export async function loadMemoir(room,id){return take(await client(true).from('memoirs').select('*').eq('room_id',room).eq('id',id).single());}
export async function saveMemoir(row){
  const {id,revision,...fields}=row;
  if(revision){
    const result=await client(true).from('memoirs').update({...fields,revision:revision+1}).eq('id',id).eq('revision',revision).select().maybeSingle();
    take(result);
    if(!result.data)throw Object.assign(new Error('Memoir changed'),{code:'40001'});
    return result.data;
  }
  const result=await client(true).from('memoirs').insert({id,...fields}).select().single();
  if(result.error?.code==='23505'){
    const existing=await loadMemoir(fields.room_id,id);
    if(['body','title','range_start','range_end'].every(key=>existing[key]===fields[key]))return existing;
    throw Object.assign(new Error('Memoir changed'),{code:'40001'});
  }
  return take(result);
}
export async function deleteMemoir(room,id,revision){const rows=take(await client(true).from('memoirs').delete().eq('room_id',room).eq('id',id).eq('revision',revision).select('id'));if(!rows?.length)throw Object.assign(new Error('Memoir changed'),{code:'40001'});}
export async function allMessages(room,secure,onProgress=()=>{},isCancelled=()=>false){
  const byId=new Map();let before;
  for(let page=0;page<100;page++){
    if(isCancelled())throw new DOMException('Cancelled','AbortError');
    const result=await loadMessages(room,secure,before);
    if(isCancelled())throw new DOMException('Cancelled','AbortError');
    for(const row of result.rows)byId.set(row.id,row);
    onProgress(byId.size);
    if(!result.hasMore)return [...byId.values()];
    before=result.rows.at(-1);
  }
  throw new Error('留言超过 1 万条，本次未生成，避免遗漏；请先导出或缩小房间规模。');
}
export async function readListen(room){const start=Date.now();const data=take(await client(true).rpc('mailbox_read_listen',{p_room:room}));return {...data,offset:Date.parse(data.server_now)-(start+Date.now())/2};}
export async function setListen(room,command){const start=Date.now();const data=take(await client(true).rpc('mailbox_set_listen',{p_room:room,...command}));return {...data,offset:Date.parse(data.server_now)-(start+Date.now())/2};}
export function subscribeFeatures(room,onCalendar,onListen){
  const sb=client(true);
  const channel=sb.channel('features-'+room+'-'+crypto.randomUUID())
    .on('postgres_changes',{event:'*',schema:'public',table:'anniversaries',filter:'room_id=eq.'+room},onCalendar)
    .on('postgres_changes',{event:'*',schema:'public',table:'listen_sessions',filter:'room_id=eq.'+room},onListen)
    .subscribe();
  return ()=>{void sb.removeChannel(channel);};
}
export async function mediaBlob(room,path){
  if(!mediaPathValid(path,room))throw new Error('Invalid attachment path');
  const {signedUrl}=take(await client(true).storage.from('message-media').createSignedUrl(path,120));
  const result=await fetch(signedUrl,{signal:AbortSignal.timeout(30000)});
  if(!result.ok)throw new Error('Attachment download failed');
  return result.blob();
}
export async function discardMedia(path){take(await client(true).storage.from('message-media').remove([path]));}
