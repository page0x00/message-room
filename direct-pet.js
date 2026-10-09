import {localConnections,directModel,localFingerprint} from './local-api.js?v=2.7.3';
import {instructions,schema,validatePet} from './supabase/functions/_shared/pet-policy.js?v=2.7.3';

export async function generateDirectPet({sb,user,room,signal,current=()=>true,connections=localConnections,call=directModel}){
 const connection=connections.active(user);if(!connection)throw new Error('请先保存并启用本机 API 连接。');
 const scope=new URL(connection.profile.base_url).origin,config=await localFingerprint(connection);
 const args={p_room:room,p_scope:scope,p_config:config};
 const unwrap=result=>{if(result.error){const code=result.error.code;throw new Error(['PGRST202','42883'].includes(code)?'聊天授权接口需要更新，请执行最新版安装 SQL；API Key 不需要存入数据库。':code==='P0001'?'这次先休息一会儿，稍后再生成。':'聊天或授权已变化，请重新确认当前渠道的授权。');}return result.data;};
 const valid=async()=>{if(signal?.aborted||!current())throw new DOMException('已取消。','AbortError');const latest=connections.active(user);if(!latest||await localFingerprint(latest)!==config)throw new Error('本机 API 配置已变化，这次结果没有保存。');};
 await valid();
 const prepared=unwrap(await sb.rpc('mailbox_pet_prepare_direct',args).abortSignal(signal));await valid();
 if(prepared.empty||prepared.cached)return prepared;
 let pet;try{pet=validatePet(await call(connection.profile,connection.key,{instructions,input:JSON.stringify(prepared.context),schema},{signal}),prepared.context);}catch(e){if(e.name==='AbortError')throw e;throw new Error(e.message||'模型没有返回可验证的完整回忆。');}
 await valid();if(typeof prepared.name==='string'&&prepared.name)pet.name=prepared.name.slice(0,24);
 const saved=unwrap(await sb.rpc('mailbox_pet_finish_direct',{...args,p_request:prepared.request,p_data:pet}).abortSignal(signal));await valid();
 return {state:saved};
}
