import {instructions,schema,validatePet} from './policy.mjs';
import {currentConnection} from '../_shared/ai-store.js';
import {callModel} from '../_shared/ai-network.js';

export function petHandler({admin,env,connection=currentConnection,call=callModel}){
 const origin=env('MAILBOX_ORIGIN')||'https://page0x00.github.io';
 const cors={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Vary':'Origin','Cache-Control':'no-store'};
 const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json'}});
 return async req=>{
  try{
   if(req.headers.get('origin')&&req.headers.get('origin')!==origin)return reply({error:'Origin denied'},403);
   if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
   const token=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'');if(!token)return reply({error:'请先登录。'},401);
   const {data:auth,error}=await admin.auth.getUser(token);if(error||!auth.user)return reply({error:'请重新登录。'},401);
   if(!['GET','POST'].includes(req.method))return reply({error:'Method not allowed'},405);
   const user=auth.user.id,active=await connection(admin,user,env),profile=active?.profile,scope=profile?new URL(profile.base_url).origin:null;
   if(req.method==='GET')return reply({configured:!!active,provider:profile?.name||null,model:profile?.model||null,scope});
   if(!active)return reply({error:'AI 暂时未连接，请在「API 与模型」中配置。'},503);
   const raw=await req.text();if(raw.length>2048)return reply({error:'Invalid request'},400);
   let body;try{body=JSON.parse(raw);}catch{return reply({error:'Invalid request'},400);}
   if(typeof body?.room!=='string'||!/^v2_[A-Za-z0-9_-]{1,96}$/.test(body.room))return reply({error:'Invalid room'},400);
   const config=JSON.stringify(profile)+':'+active.revision;
   const prepared=await admin.rpc('mailbox_pet_prepare',{p_room:body.room,p_user:user,p_scope:scope,p_config:config});
   if(prepared.error)return reply({error:prepared.error.code==='P0001'?'这次先休息一会儿，稍后再生成。':'请重新确认对当前 API 渠道的聊天授权。'},prepared.error.code==='P0001'?429:403);
   if(prepared.data.empty)return reply({empty:true});if(prepared.data.cached)return reply({state:prepared.data.state,cached:true});
   let pet;try{pet=validatePet(await call(profile,active.key,{instructions,input:JSON.stringify(prepared.data.context),schema}),prepared.data.context);}catch{return reply({error:'AI 未返回可验证的完整回忆，请检查接口、模型或参数。原来的记忆会保留。'},502);}
   const latest=await connection(admin,user,env);
   if(!latest||JSON.stringify(latest.profile)+':'+latest.revision!==config)return reply({error:'API 配置已改变，这次结果没有保存。请重试。'},409);
   if(typeof prepared.data.name==='string'&&prepared.data.name)pet.name=prepared.data.name.slice(0,24);
   const saved=await admin.rpc('mailbox_pet_finish',{p_room:body.room,p_user:user,p_request:prepared.data.request,p_data:pet,p_scope:scope,p_config:config});
   if(saved.error)return reply({error:'聊天或授权刚刚变化，这次结果没有保存。请重试。'},409);
   return reply({state:saved.data});
  }catch{return reply({error:'AI 配置暂时不可用，请检查 API 设置和后台部署。原来的记忆会保留。'},503);}
 };
}
