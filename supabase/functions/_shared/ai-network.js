import {Buffer} from 'node:buffer';
import {lookup} from 'node:dns/promises';
import {request} from 'node:https';
import {isIP} from 'node:net';
import {baseURL,requestHeaders,buildRequest,responseJSON} from './ai-providers.js';

export function publicAddress(address){
  if(isIP(address)===4){const [a,b,c]=address.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||(b===0&&(c===0||c===2))||(b===88&&c===99)))||(a===198&&(b===18||b===19||(b===51&&c===100)))||(a===203&&b===0&&c===113));}
  // Only global IPv6 unicast; exclude transition, documentation and protocol space.
  if(isIP(address)===6){const [first,second]=address.split(':').map(n=>parseInt(n||'0',16));return first>=0x2000&&first<0x4000&&first!==0x2002&&first!==0x3fff&&!(first===0x2001&&(second<0x200||second===0xdb8));}
  return false;
}
export async function providerJSON(url,{headers,body,timeout=55},deps={lookup,request}){
  const target=new URL(url);baseURL(target.origin);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout*1000);
  try{
    let addresses;try{addresses=await Promise.race([deps.lookup(target.hostname,{all:true,verbatim:true}),new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(new Error('接口连接超时。')),{once:true}))]);}catch{throw new Error(controller.signal.aborted?'接口连接超时。':'接口域名无法解析，请检查地址。');}
    if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw new Error('接口域名未指向公网地址。');
    if(controller.signal.aborted)throw new Error('接口连接超时。');
    // Connect to the checked IP, keeping the original TLS SNI and Host. No second
    // DNS lookup or redirect can route the credential to an unvalidated host.
    return await new Promise((resolve,reject)=>{
      const req=deps.request({protocol:'https:',hostname:addresses[0].address,family:addresses[0].family,port:target.port||443,servername:target.hostname,path:target.pathname+target.search,method:body===undefined?'GET':'POST',headers:{...headers,Host:target.host},signal:controller.signal,rejectUnauthorized:true},res=>{
        if(res.statusCode<200||res.statusCode>=300){res.destroy();reject(new Error(({401:'密钥无效或鉴权方式不匹配。',403:'此密钥没有访问权限。',404:'接口地址或模型不存在。',429:'服务商限流或额度不足。'})[res.statusCode]||'服务商返回 HTTP '+res.statusCode+'；请检查协议和参数。'));return;}
        let data='',size=0;res.setEncoding('utf8');res.on('data',chunk=>{size+=Buffer.byteLength(chunk);if(size>1048576){req.destroy();reject(new Error('接口响应过大。'));}else data+=chunk;});
        res.on('error',()=>reject(new Error('接口响应中断。')));res.on('end',()=>{try{resolve(JSON.parse(data));}catch{reject(new Error('接口没有返回有效 JSON。'));}});
      });
      req.on('error',()=>reject(new Error(controller.signal.aborted?'接口连接超时。':'无法连接接口，请检查地址和网络。')));
      if(body!==undefined)req.write(JSON.stringify(body));req.end();
    });
  }finally{clearTimeout(timer);}
}
export async function callModel(profile,key,task,transport=providerJSON){
  const {url,body}=buildRequest(profile,task);
  return responseJSON(profile.protocol,await transport(url,{headers:requestHeaders(profile,key),body,timeout:profile.timeout}));
}
export async function listModels(profile,key,transport=providerJSON){
  const result=await transport(profile.base_url+'/models',{headers:requestHeaders(profile,key),timeout:profile.timeout});
  const values=profile.protocol==='gemini'?(result.models||[]).filter(m=>m.supportedGenerationMethods?.includes('generateContent')).map(m=>m.name?.replace(/^models\//,'')):(result.data||[]).map(m=>m.id);
  return [...new Set(values.filter(v=>typeof v==='string'&&v.length<=160))].sort().slice(0,500);
}
