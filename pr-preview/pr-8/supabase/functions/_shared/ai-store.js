import {normalizeProfile} from './ai-providers.js';
const encode=data=>btoa(String.fromCharCode(...new Uint8Array(data)));
const decode=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
export function encryptionReady(env){try{return decode(env('MAILBOX_API_ENCRYPTION_KEY')||'').length===32;}catch{return false;}}
async function encryptionKey(env){if(!encryptionReady(env))throw new Error('站点尚未配置 API 密钥加密，请联系站点主人。');return crypto.subtle.importKey('raw',decode(env('MAILBOX_API_ENCRYPTION_KEY')),'AES-GCM',false,['encrypt','decrypt']);}
export async function sealKey(value,user,id,env){
  if(typeof value!=='string'||!value.trim()||value.length>4096||/[\r\n]/.test(value))throw new Error('请填写有效的 API Key。');
  const iv=crypto.getRandomValues(new Uint8Array(12)),key=await encryptionKey(env),aad=new TextEncoder().encode(user+':'+id);
  const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},key,new TextEncoder().encode(value.trim()));
  return {v:1,iv:encode(iv),data:encode(data)};
}
export async function openKey(value,user,id,env){
  try{return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(value.iv),additionalData:new TextEncoder().encode(user+':'+id)},await encryptionKey(env),decode(value.data)));}
  catch{throw new Error('已存密钥无法解密，请重新填写并保存。');}
}
export function legacyProfile(env){
  const key=env('MAILBOX_API_KEY')||env('OPENAI_API_KEY'),model=env('MAILBOX_PET_MODEL');if(!key||!model)return null;
  const protocol=env('MAILBOX_API_PROTOCOL')||'responses';
  return {profile:normalizeProfile({name:'站点默认',provider:'custom',protocol,base_url:env('MAILBOX_API_BASE_URL')||'https://api.openai.com/v1',model,auth:env('MAILBOX_API_AUTH')||'bearer',format:env('MAILBOX_API_FORMAT')||(protocol==='responses'?'schema':'prompt')}),key};
}
export async function readSettings(admin,user,{legacyOK=false}={}){
  const result=await admin.from('mailbox_api_settings').select('*').eq('user_id',user).maybeSingle();
  if(result.error){if(legacyOK&&['42P01','PGRST205'].includes(result.error.code))return {connections:[],active_id:null,revision:0};throw new Error('API 设置尚不可用，请更新数据库和 mailbox-api 函数。');}
  return result.data||{connections:[],active_id:null,revision:0};
}
export const publicProfile=record=>({...normalizeProfile(record),id:record.id,has_key:!!record.secret});
export async function currentConnection(admin,user,env){
  const settings=await readSettings(admin,user,{legacyOK:true}),record=settings.connections.find(p=>p.id===settings.active_id);
  if(settings.active_id&&!record)throw new Error('当前 API 配置不存在，请重新选择。');
  if(record)return {profile:normalizeProfile(record),key:await openKey(record.secret,user,record.id,env),revision:settings.revision};
  const legacy=legacyProfile(env);return legacy?{...legacy,revision:settings.revision}:null;
}
export async function writeSettings(admin,user,settings,expected){
  const result=await admin.rpc('mailbox_api_save',{p_user:user,p_connections:settings.connections,p_active:settings.active_id,p_revision:expected});
  if(result.error)throw new Error(result.error.code==='40001'?'配置刚在其他设备改变，请重新打开后再保存。':'API 配置未保存，请稍后重试。');return result.data;
}
