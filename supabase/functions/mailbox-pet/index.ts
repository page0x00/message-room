import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
import {modelRequest,parsePet} from './policy.mjs';
const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const origin=Deno.env.get('MAILBOX_ORIGIN')||'https://page0x00.github.io';
const cors={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Vary':'Origin'};
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json'}});
Deno.serve(async req=>{
 try{
  if(req.headers.get('origin')&&req.headers.get('origin')!==origin)return reply({error:'Origin denied'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  const token=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'');if(!token)return reply({error:'请先登录。'},401);
  const {data:auth,error}=await admin.auth.getUser(token);if(error||!auth.user)return reply({error:'请重新登录。'},401);
  const key=Deno.env.get('OPENAI_API_KEY'),model=Deno.env.get('MAILBOX_PET_MODEL');
  if(req.method==='GET')return reply({configured:Boolean(key&&model),provider:'OpenAI',model:model||null});
  if(req.method!=='POST')return reply({error:'Method not allowed'},405);
  if(!key||!model)return reply({error:'AI 暂时未连接，请联系站点主人配置后再试。'},503);
  const raw=await req.text();if(raw.length>2048)return reply({error:'Invalid request'},400);
  let body;try{body=JSON.parse(raw);}catch{return reply({error:'Invalid request'},400);}
  if(typeof body.room!=='string'||!/^v2_[A-Za-z0-9_-]{1,96}$/.test(body.room))return reply({error:'Invalid room'},400);
  const user=auth.user.id,prepared=await admin.rpc('mailbox_pet_prepare',{p_room:body.room,p_user:user});
  if(prepared.error)return reply({error:prepared.error.code==='P0001'?'这次先休息一会儿，稍后再生成。':'聊天授权已变化，请重新确认。'},prepared.error.code==='P0001'?429:403);
  if(prepared.data.empty)return reply({empty:true});if(prepared.data.cached)return reply({state:prepared.data.state,cached:true});
  // Fixed provider URL: neither the browser nor stored messages choose a network destination.
  const result=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(modelRequest(model,prepared.data.context)),signal:AbortSignal.timeout(55000)});
  if(!result.ok)return reply({error:'AI 这次没有完成回应，稍后可以再试。'},502);
  const pet=parsePet(await result.json(),prepared.data.context);
  if(typeof prepared.data.name==='string'&&prepared.data.name)pet.name=prepared.data.name.slice(0,24);
  const saved=await admin.rpc('mailbox_pet_finish',{p_room:body.room,p_user:user,p_request:prepared.data.request,p_data:pet});
  if(saved.error)return reply({error:'聊天或授权刚刚变化，这次结果没有保存。请重试。'},409);
  return reply({state:saved.data});
 }catch{return reply({error:'AI 暂时没有回应。原来的记忆会保留。'},503);}
});
