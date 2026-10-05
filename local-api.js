import {normalizeProfile,buildRequest,requestHeaders,responseJSON,probeTask} from './supabase/functions/_shared/ai-providers.js?v=2.7.0';

const prefix='mailbox.api.local.v1.';
const validKey=value=>typeof value==='string'&&!!value.trim()&&value.length<=4096&&!/[\r\n]/.test(value);
// Local settings never pass through backend.js, RPCs or Edge functions.
export function createLocalConnections({session=()=>globalThis.sessionStorage,persistent=()=>globalThis.localStorage}={}){
 const name=user=>prefix+encodeURIComponent(user||'guest');
 function read(user){
  try{const raw=session()?.getItem(name(user))??persistent()?.getItem(name(user));if(!raw)return {profiles:[],active_id:null,revision:0,remember:false};
   const data=JSON.parse(raw);if(!Array.isArray(data.profiles)||data.profiles.length>12||!Number.isInteger(data.revision))throw Error();
   return {...data,profiles:data.profiles.map(p=>({...normalizeProfile(p),id:p.id,key:p.key}))};
  }catch{throw new Error('本机配置无法读取，请使用「清空本机配置」重新设置。');}
 }
 function view(user){const data=read(user);return {...data,profiles:data.profiles.map(({key,...p})=>({...p,has_key:validKey(key)})),default_profile:null};}
 function write(user,data){
  const value=JSON.stringify(data);try{if(data.remember){persistent().setItem(name(user),value);session().removeItem(name(user));}else{session().setItem(name(user),value);persistent().removeItem(name(user));}}
  catch{throw new Error('浏览器未能保存配置，请检查本机存储权限。');}
 }
 function mode(user){try{return persistent()?.getItem(name(user)+'.mode')||null;}catch{return null;}}
 function choose(user,value){if(!['local','cloud'].includes(value))throw Error('Invalid mode');try{persistent().setItem(name(user)+'.mode',value);}catch{throw new Error('浏览器未能保存连接方式。');}}
 function credential(user,id,profile,key){
  const saved=read(user).profiles.find(p=>p.id===id);if(id&&!saved)throw new Error('本机配置已改变，请重新打开设置。');
  if(saved&&new URL(saved.base_url).origin!==new URL(profile.base_url).origin&&!key)throw new Error('接口域名已改变，请重新填写对应渠道的 API Key。');
  const result=key||saved?.key;if(!validKey(result))throw new Error('请填写 API Key。');return result.trim();
 }
 function change(user,body){
  const data=read(user);if(data.revision!==body.revision)throw new Error('本机配置已改变，请重新打开后再保存。');
  if(body.action==='save'){
   const profile=normalizeProfile(body.profile);buildRequest(profile,probeTask);const key=credential(user,body.id,profile,body.key),id=body.id||crypto.randomUUID();
   if(!body.id&&data.profiles.length>=12)throw new Error('最多保存 12 套本机配置。');
   const saved={...profile,id,key};data.profiles=body.id?data.profiles.map(p=>p.id===id?saved:p):data.profiles.concat(saved);data.active_id=id;data.remember=!!body.remember;data.revision++;write(user,data);choose(user,'local');return {...view(user),saved_id:id};
  }
  if(body.action==='delete'){if(!data.profiles.some(p=>p.id===body.id))throw new Error('找不到本机配置。');data.profiles=data.profiles.filter(p=>p.id!==body.id);if(data.active_id===body.id)data.active_id=null;}
  else if(body.action==='activate')data.active_id=null;
  else throw new Error('不支持此操作。');
  data.revision++;write(user,data);if(body.action==='activate')choose(user,'local');return view(user);
 }
 function active(user){if(mode(user)!=='local')return null;const data=read(user),record=data.profiles.find(p=>p.id===data.active_id);if(!record)return null;const {key,id,...profile}=record;return {profile:normalizeProfile(profile),key,id,revision:data.revision};}
 function clear(user){try{session()?.removeItem(name(user));persistent()?.removeItem(name(user));choose(user,'local');}catch{throw new Error('本机配置未能清除，请检查浏览器权限。');}}
 function clearSession(user){try{session()?.removeItem(name(user));}catch{/* No credential is sent anywhere when storage is unavailable. */}}
 return {view,mode,choose,credential,change,active,clear,clearSession};
}
export const localConnections=createLocalConnections();

async function directJSON(profile,key,path,{body,signal,fetcher=fetch}={}){
 if(!validKey(key))throw new Error('请填写 API Key。');
 const headers=requestHeaders(profile,key.trim());
 if(profile.protocol==='anthropic')headers['anthropic-dangerous-direct-browser-access']='true';
 const timeout=AbortSignal.timeout(profile.timeout*1000),combined=signal?AbortSignal.any([timeout,signal]):timeout;
 try{
  const result=await fetcher(path,{method:body===undefined?'GET':'POST',headers,...(body===undefined?{}:{body:JSON.stringify(body)}),mode:'cors',credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',signal:combined});
  if(!result.ok){await result.body?.cancel();throw new Error(({401:'密钥无效或鉴权方式不匹配。',403:'此密钥没有访问权限。',404:'接口地址或模型不存在。',429:'服务商限流或额度不足。'})[result.status]||'服务商返回 HTTP '+result.status+'，请检查接口协议和参数。');}
  const reader=result.body?.getReader();if(!reader)throw new Error('接口没有返回数据。');
  const decoder=new TextDecoder();let text='',size=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>1048576)throw new Error('接口响应过大。');text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{await reader.cancel().catch(()=>{});}
  try{return JSON.parse(text);}catch{throw new Error('接口没有返回有效 JSON。');}
 }catch(error){
  if(signal?.aborted)throw new DOMException('请求已取消。','AbortError');
  if(timeout.aborted)throw new Error('接口响应超时，可调整超时参数后重试。');
  if(error instanceof TypeError)throw new Error('浏览器无法直连接口：请检查网络、地址及渠道的跨域（CORS）支持。可使用允许浏览器调用的渠道；不会自动转发 Key。');
  throw error;
 }
}
export async function directModel(profile,key,task,options={}){
 const p=normalizeProfile(profile),{url,body}=buildRequest(p,task),result=await directJSON(p,key,url,{...options,body});
 try{return responseJSON(p.protocol,result);}catch{throw new Error('模型未返回完整有效的 JSON，请检查输出方式和参数。');}
}
export async function directModels(profile,key,options={}){
 const p=normalizeProfile(profile),result=await directJSON(p,key,p.base_url+'/models',options);
 const values=p.protocol==='gemini'?(result.models||[]).filter(m=>m.supportedGenerationMethods?.includes('generateContent')).map(m=>m.name?.replace(/^models\//,'')):(result.data||[]).map(m=>m.id);
 return [...new Set(values.filter(v=>typeof v==='string'&&v.length<=160))].sort().slice(0,500);
}
export async function localFingerprint(connection){
 const source=JSON.stringify({profile:connection.profile,id:connection.id,revision:connection.revision});
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source)))].map(b=>b.toString(16).padStart(2,'0')).join('');
}
