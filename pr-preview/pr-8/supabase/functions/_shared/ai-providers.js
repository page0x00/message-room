// Shared by the settings preview and the Edge functions. No credentials live here.
export const providers = [
  {id:'openai',name:'OpenAI · 官方',protocol:'responses',base_url:'https://api.openai.com/v1',auth:'bearer',format:'schema'},
  {id:'anthropic',name:'Anthropic Claude · 官方',protocol:'anthropic',base_url:'https://api.anthropic.com/v1',auth:'anthropic',format:'prompt'},
  {id:'gemini',name:'Google Gemini · 官方',protocol:'gemini',base_url:'https://generativelanguage.googleapis.com/v1beta',auth:'google',format:'json'},
  {id:'deepseek',name:'DeepSeek · 官方',protocol:'chat',base_url:'https://api.deepseek.com/v1',auth:'bearer',format:'json'},
  {id:'azure',name:'Azure OpenAI · 云托管',protocol:'chat',base_url:'',auth:'api-key',format:'schema'},
  {id:'openrouter',name:'OpenRouter · 聚合渠道',protocol:'chat',base_url:'https://openrouter.ai/api/v1',auth:'bearer',format:'json'},
  {id:'custom',name:'第三方 / 公益站 / 自定义',protocol:'chat',base_url:'',auth:'bearer',format:'prompt'},
];
export const protocols = {responses:'OpenAI Responses',chat:'Chat Completions 兼容',anthropic:'Anthropic Messages',gemini:'Gemini generateContent'};
export const parameters = [
  {key:'temperature',label:'温度',min:0,max:2,step:0.1},
  {key:'top_p',label:'Top P',min:0,max:1,step:0.05},
  {key:'max_tokens',label:'最大输出 tokens',min:1,max:131072,step:1},
  {key:'frequency_penalty',label:'频率惩罚',min:-2,max:2,step:0.1,only:['chat']},
  {key:'presence_penalty',label:'存在惩罚',min:-2,max:2,step:0.1,only:['chat']},
  {key:'seed',label:'随机种子',min:0,max:2147483647,step:1,only:['chat','gemini']},
  {key:'top_k',label:'Top K',min:1,max:1000,step:1,only:['anthropic','gemini']},
];
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const forbidden = new Set(['__proto__','prototype','constructor']);
const reserved = new Set(['model','models','route','messages','input','instructions','system','systemInstruction','contents','stream','background','tools','tool_choice','toolConfig','functions','function_call','plugins','web_search_options','previous_response_id','conversation','prompt','store','n','api_key','apiKey','headers','authorization']);
function jsonObject(value){
  if(!plain(value))throw new Error('高级参数必须是 JSON 对象。');
  const walk=(item,depth=0)=>{if(depth>8)throw new Error('高级参数嵌套过深。');if(item&&typeof item==='object')for(const [key,val] of Object.entries(item)){if(forbidden.has(key))throw new Error('参数名不允许使用 '+key);walk(val,depth+1);}};
  walk(value);if(JSON.stringify(value).length>8000)throw new Error('高级参数最多 8000 字符。');return JSON.parse(JSON.stringify(value));
}
export function baseURL(value){
  let url;try{url=new URL(String(value).trim());}catch{throw new Error('请填写完整的 HTTPS 接口地址。');}
  const host=url.hostname.toLowerCase();
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!host.includes('.')||!/[a-z]/.test(host)||!/^[a-z0-9.-]+$/.test(host)||/(^|\.)(localhost|local|internal|test|invalid)$/.test(host)||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal'))throw new Error('接口须使用公网 HTTPS 域名，不能包含密钥、查询参数或本地地址。');
  // Accept a copied endpoint as well as a base URL; append the protocol path once.
  url.pathname=url.pathname.replace(/\/(responses|chat\/completions|messages|models\/[^/]+:generateContent)\/?$/,'').replace(/\/+$/,'');
  return url.href.replace(/\/+$/,'');
}
export function normalizeProfile(raw){
  if(!plain(raw))throw new Error('配置格式不正确。');
  const provider=providers.find(p=>p.id===raw.provider);if(!provider)throw new Error('请选择服务渠道。');
  if(!Object.hasOwn(protocols,raw.protocol))throw new Error('请选择接口协议。');
  const name=String(raw.name||'').trim(),model=String(raw.model||'').trim();
  if(!name||name.length>60)throw new Error('配置名称需为 1–60 个字符。');
  if(!model||model.length>160||/[\s?#\\]/.test(model))throw new Error('请填写服务商提供的模型 ID。');
  const base_url=baseURL(raw.base_url),auth=raw.auth||provider.auth,format=raw.format||'prompt';
  if(!['bearer','api-key','anthropic','google'].includes(auth))throw new Error('请选择鉴权方式。');
  if(!['schema','json','prompt'].includes(format))throw new Error('请选择输出方式。');
  if(raw.protocol==='anthropic'&&format!=='prompt')throw new Error('Messages 协议请使用提示词 JSON 输出。');
  const timeout=raw.timeout??55;if(!Number.isInteger(timeout)||timeout<5||timeout>55)throw new Error('超时应在 5–55 秒之间。');
  const params={};for(const spec of parameters){const value=raw.params?.[spec.key];if(value===undefined||value===null||value==='')continue;
    if(spec.only&&!spec.only.includes(raw.protocol))throw new Error(spec.label+' 不适用于此协议，请在高级参数中使用服务商自己的字段。');
    const max=raw.protocol==='anthropic'&&spec.key==='temperature'?1:spec.max;
    if(typeof value!=='number'||!Number.isFinite(value)||value<spec.min||value>max||(spec.step===1&&!Number.isInteger(value)))throw new Error(spec.label+' 超出允许范围。');params[spec.key]=value;
  }
  if(raw.params?.stop!==undefined){if(!Array.isArray(raw.params.stop)||raw.params.stop.length>4||raw.params.stop.some(v=>typeof v!=='string'||!v||v.length>100))throw new Error('停止词最多 4 项，每项 1–100 字符。');params.stop=raw.params.stop;}
  if(raw.params?.reasoning_effort){if(!['none','minimal','low','medium','high','xhigh'].includes(raw.params.reasoning_effort)||!['responses','chat'].includes(raw.protocol))throw new Error('思考强度不适用于此协议。');params.reasoning_effort=raw.params.reasoning_effort;}
  const extra=jsonObject(raw.extra||{});for(const key of Object.keys(extra))if(reserved.has(key))throw new Error(key+' 由应用管理，不能覆盖。');
  const exclude=Array.isArray(raw.exclude)?[...new Set(raw.exclude)]:[];
  if(exclude.length>40)throw new Error('最多排除 40 个参数。');
  for(const path of exclude){if(typeof path!=='string'||path.length>160||!/^\w+(\.\w+)*$/.test(path)||path.split('.').some(k=>forbidden.has(k))||reserved.has(path.split('.')[0])||(raw.protocol==='anthropic'&&path==='max_tokens'))throw new Error('不能排除此字段：'+path);}
  return {name,provider:provider.id,protocol:raw.protocol,base_url,model,auth,format,timeout,params,extra,exclude};
}
function merge(target,source){for(const [key,value] of Object.entries(source)){if(plain(value)&&plain(target[key]))merge(target[key],value);else target[key]=structuredClone(value);}return target;}
function remove(target,path){const parts=path.split('.'),key=parts.pop();let at=target;for(const p of parts){at=at?.[p];if(!plain(at))return;}delete at[key];}
export function buildRequest(raw,{instructions,input,schema,name='memory_pet'}){
  const p=normalizeProfile(raw),v=p.params;
  const prompt=instructions+'\n只返回一个 JSON 对象，不加 Markdown 或解释。JSON Schema：'+JSON.stringify(schema);
  let body,url=p.base_url;
  if(p.protocol==='responses'){
    url+='/responses';body={model:p.model,store:false,max_output_tokens:v.max_tokens??1800,instructions:prompt,input:[{role:'user',content:input}]};
    if(p.format!=='prompt')body.text={format:p.format==='schema'?{type:'json_schema',name,strict:true,schema}:{type:'json_object'}};
    for(const k of ['temperature','top_p'])if(v[k]!==undefined)body[k]=v[k];
    if(v.stop)throw new Error('Responses 不支持通用停止词，请清空停止词。');
    if(v.reasoning_effort)body.reasoning={effort:v.reasoning_effort};
  }else if(p.protocol==='chat'){
    url+='/chat/completions';body={model:p.model,messages:[{role:'system',content:prompt},{role:'user',content:input}],max_tokens:v.max_tokens??1800};
    if(p.format!=='prompt')body.response_format=p.format==='schema'?{type:'json_schema',json_schema:{name,strict:true,schema}}:{type:'json_object'};
    for(const k of ['temperature','top_p','frequency_penalty','presence_penalty','seed','stop','reasoning_effort'])if(v[k]!==undefined)body[k]=v[k];
  }else if(p.protocol==='anthropic'){
    url+='/messages';body={model:p.model,system:prompt,messages:[{role:'user',content:input}],max_tokens:v.max_tokens??1800};
    for(const k of ['temperature','top_p','top_k'])if(v[k]!==undefined)body[k]=v[k];
    if(v.stop)body.stop_sequences=v.stop;
  }else{
    url+='/models/'+encodeURIComponent(p.model.replace(/^models\//,''))+':generateContent';
    body={systemInstruction:{parts:[{text:prompt}]},contents:[{role:'user',parts:[{text:input}]}],generationConfig:{maxOutputTokens:v.max_tokens??1800}};
    for(const [key,field] of Object.entries({temperature:'temperature',top_p:'topP',top_k:'topK',seed:'seed',stop:'stopSequences'}))if(v[key]!==undefined)body.generationConfig[field]=v[key];
    if(p.format!=='prompt')body.generationConfig.responseMimeType='application/json';
    if(p.format==='schema')body.generationConfig.responseJsonSchema=schema;
  }
  merge(body,p.extra);for(const path of p.exclude)remove(body,path);
  // Empty format/config objects upset some compatible gateways.
  if(body.text&&Object.keys(body.text).length===0)delete body.text;
  if(body.generationConfig&&Object.keys(body.generationConfig).length===0)delete body.generationConfig;
  return {url,body};
}
export function requestHeaders(profile,key){
  const headers={'Content-Type':'application/json'};
  if(profile.auth==='bearer')headers.Authorization='Bearer '+key;
  else if(profile.auth==='api-key')headers['api-key']=key;
  else if(profile.auth==='anthropic')headers['x-api-key']=key;
  else headers['x-goog-api-key']=key;
  if(profile.protocol==='anthropic')headers['anthropic-version']='2023-06-01';
  return headers;
}
export function responseJSON(protocol,response){
  let text;
  if(protocol==='responses'){
    if(response.status!=='completed')throw new Error('模型输出未完成。');
    text=(response.output||[]).flatMap(i=>i.content||[]).filter(i=>i.type==='output_text').map(i=>i.text).join('');
  }else if(protocol==='chat'){
    const choice=response.choices?.[0];if(!choice||choice.finish_reason!=='stop'||choice.message?.refusal||choice.message?.tool_calls)throw new Error('模型输出未完成或被拒绝。');text=choice.message?.content;
  }else if(protocol==='anthropic'){
    if(!['end_turn','stop_sequence'].includes(response.stop_reason))throw new Error('模型输出未完成。');text=(response.content||[]).filter(p=>p.type==='text').map(p=>p.text).join('');
  }else{
    const candidate=response.candidates?.[0];if(candidate?.finishReason!=='STOP')throw new Error('模型输出未完成或被拦截。');text=(candidate.content?.parts||[]).filter(p=>!p.thought).map(p=>p.text||'').join('');
  }
  if(typeof text!=='string'||!text.trim())throw new Error('模型没有返回文字。');
  return JSON.parse(text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i,'$1'));
}
export const probeTask={instructions:'这是连接测试。返回 {"ok":true}。',input:'只测试接口，不读取任何聊天。',schema:{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false},name:'connection_test'};
