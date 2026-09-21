// A subscription is supplied by a browser but remains untrusted network input.
export function allowedEndpoint(value){
  try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443'||u.hash)return false;
    return u.hostname==='fcm.googleapis.com'||u.hostname==='updates.push.services.mozilla.com'||u.hostname==='web.push.apple.com'||u.hostname.endsWith('.push.apple.com')||u.hostname.endsWith('.notify.windows.com');
  }catch{return false;}
}
export function messageId(value){const id=String(value??'');return /^[a-zA-Z0-9-]{1,80}$/.test(id)?id:null;}
export function notificationPayload(message){return JSON.stringify({room:message.room_id,id:String(message.id)});}
export async function sameSecret(left,right){
  if(!left||!right)return false;
  const hash=async x=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(x)));
  const [a,b]=await Promise.all([hash(left),hash(right)]);let difference=0;for(let i=0;i<a.length;i++)difference|=a[i]^b[i];return difference===0;
}
