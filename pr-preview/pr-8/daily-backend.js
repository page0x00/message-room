import {client,uploadMedia} from './backend.js?v=2.6.2';
import {fileInfo} from './feature-core.js?v=2.6.2';
import {randomId} from './core.js?v=2.6.2';
const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const take=r=>{if(r.error)throw r.error;return r.data;};
export async function listRows(table,room){let rows=[];for(let offset=0;offset<50000;offset+=500){const page=take(await client(true).from(table).select('*').eq('room_id',room).order('id').range(offset,offset+499))||[];rows.push(...page);if(page.length<500)return rows;}throw new Error('记录较多，请缩小查询范围。');}
export async function saveEntry(row){
 if(row.revision){const {id,created_at,updated_at,...fields}=row;const result=take(await client(true).from('space_entries').update({...fields,revision:row.revision+1}).eq('id',id).eq('revision',row.revision).select().maybeSingle());if(!result)throw Object.assign(new Error('这条记录已被修改，请刷新后再编辑。'),{code:'40001'});return result;}
 const {revision,...fields}=row,result=await client(true).from('space_entries').insert(fields).select().single();
 if(result.error?.code==='23505'){const old=take(await client(true).from('space_entries').select('*').eq('id',row.id).maybeSingle());if(old&&['kind','title','body','event_date','visibility'].every(k=>old[k]===row[k])&&stable(old.data)===stable(row.data))return old;throw new Error('这一天已经打过卡，或记录已被修改，请刷新后查看。');}return take(result);
}
export async function deleteEntry(row){const rows=take(await client(true).from('space_entries').delete().eq('id',row.id).eq('revision',row.revision).select('id'));if(!rows?.length)throw new Error('记录已经变化，请刷新后再试。');}
export const rpc=async(name,params)=>take(await client(true).rpc(name,params));
export async function upload(file,s,cache){let row=cache.get(file);if(row)return row;const info=fileInfo(file),path=`${s.room}/${s.userId}/${randomId()}`;row={path,name:info.name,mime:info.mime,size:info.size,type:info.type};cache.set(file,row);try{await uploadMedia(path,file,info.mime,()=>{});}catch(e){cache.delete(file);throw e;}return row;}
export function watch(room,changed){const sb=client(true),channel=sb.channel('daily-'+randomId());for(const table of ['space_entries','pockets','pocket_entries','pocket_leaves'])channel.on('postgres_changes',{event:'*',schema:'public',table,filter:'room_id=eq.'+room},changed);channel.subscribe();return()=>sb.removeChannel(channel);}
