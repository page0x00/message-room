import {normalizeProfile,buildRequest,probeTask} from '../_shared/ai-providers.js';
import {encryptionReady,sealKey,openKey,readSettings,publicProfile,legacyProfile,writeSettings} from '../_shared/ai-store.js';
import {callModel,listModels} from '../_shared/ai-network.js';

export function apiHandler({admin,env,call=callModel,models=listModels}){
  const origin=env('MAILBOX_ORIGIN')||'https://page0x00.github.io';
  const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Vary':'Origin','Content-Type':'application/json','Cache-Control':'no-store'};
  const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
  return async req=>{
    try{
      if(req.headers.get('origin')&&req.headers.get('origin')!==origin)return reply({error:'Origin denied'},403);
      if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
      const token=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'');if(!token)return reply({error:'请先登录。'},401);
      const auth=await admin.auth.getUser(token);if(auth.error||!auth.data.user)return reply({error:'请重新登录。'},401);
      const user=auth.data.user.id;
      if(!['GET','POST'].includes(req.method))return reply({error:'Method not allowed'},405);
      const settings=await readSettings(admin,user);
      const view=()=>{
        let default_profile=null;try{default_profile=legacyProfile(env)?.profile||null;}catch{/* A broken site default must not block editing personal connections. */}
        return {profiles:settings.connections.map(publicProfile),active_id:settings.active_id,revision:settings.revision,encryption_ready:encryptionReady(env),default_profile};
      };
      if(req.method==='GET')return reply(view());
      const raw=await req.text();if(raw.length>20000)return reply({error:'配置内容过长。'},400);
      let body;try{body=JSON.parse(raw);}catch{return reply({error:'配置不是有效 JSON。'},400);}
      if(!body||typeof body!=='object')return reply({error:'配置格式不正确。'},400);
      if(body.revision!==settings.revision)return reply({error:'配置刚在其他设备改变，请重新打开后再保存。'},409);
      const record=settings.connections.find(p=>p.id===body.id);
      if(['save','test','models'].includes(body.action)){
        if(body.id&&!record)return reply({error:'找不到这个配置。'},404);
        const profile=normalizeProfile(body.profile);buildRequest(profile,probeTask);
        // Reusing an encrypted key at a different origin requires explicit re-entry.
        if(record&&new URL(record.base_url).origin!==new URL(profile.base_url).origin&&!body.key)return reply({error:'接口域名已改变，请重新填写对应渠道的 API Key。'},400);
        if(body.action==='save'){
          if(!record&&settings.connections.length>=12)return reply({error:'最多保存 12 套配置。'},400);
          const id=record?.id||crypto.randomUUID();
          const secret=body.key?await sealKey(body.key,user,id,env):record?.secret;if(!secret)return reply({error:'请填写 API Key。'},400);
          if(!encryptionReady(env))return reply({error:'站点尚未配置 API 密钥加密。'},503);
          const updated={...profile,id,secret};settings.connections=record?settings.connections.map(p=>p.id===id?updated:p):settings.connections.concat(updated);
          if(body.activate===true)settings.active_id=id;
          const result=await writeSettings(admin,user,settings,body.revision);settings.revision=result.revision;return reply({...view(),saved_id:id});
        }
        let key=body.key;if(!key&&record)key=await openKey(record.secret,user,record.id,env);
        if(typeof key!=='string'||!key.trim()||key.length>4096||/[\r\n]/.test(key))return reply({error:'请填写 API Key。'},400);
        const budget=await admin.rpc('mailbox_api_check_budget',{p_user:user});if(budget.error)return reply({error:'连接检查过于频繁，请稍后再试。'},429);
        if(body.action==='models')return reply({models:await models(profile,key.trim())});
        const started=Date.now(),result=await call(profile,key.trim(),probeTask);
        if(result?.ok!==true)return reply({error:'接口已响应，但未返回符合要求的 JSON；请调整输出方式或参数。'},502);
        return reply({ok:true,elapsed_ms:Date.now()-started});
      }
      if(body.action==='activate'){
        if(body.id!==null&&!record)return reply({error:'找不到这个配置。'},404);
        settings.active_id=body.id;
      }else if(body.action==='delete'){
        if(!record)return reply({error:'找不到这个配置。'},404);
        settings.connections=settings.connections.filter(p=>p.id!==body.id);if(settings.active_id===body.id)settings.active_id=null;
      }else return reply({error:'操作不支持。'},400);
      const result=await writeSettings(admin,user,settings,body.revision);settings.revision=result.revision;return reply(view());
    }catch(error){return reply({error:error instanceof Error?error.message:'API 操作暂时失败。'},400);}
  };
}
