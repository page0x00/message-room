let dbPromise;
function database(){return dbPromise ||= new Promise((resolve,reject)=>{const request=indexedDB.open('mailbox-screenshots',1);request.onupgradeneeded=()=>request.result.createObjectStore('records');request.onsuccess=()=>resolve(request.result);request.onerror=()=>{dbPromise=null;reject(request.error);};});}
export async function screenshotRecord(scope,key,value){
  const db=await database();return new Promise((resolve,reject)=>{const write=arguments.length===3,tx=db.transaction('records',write?'readwrite':'readonly'),store=tx.objectStore('records'),id=scope+':'+key,request=write?store.put(value,id):store.get(id);let result;request.onsuccess=()=>result=request.result;tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>reject(tx.error||new Error('无法保存本机识别记录'));});
}
export async function imageHash(file){const bytes=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');}
