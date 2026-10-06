export function fullDuration(seconds){const s=Math.max(0,Math.floor(Number(seconds)||0));return `${Math.floor(s/3600)} 小时 ${Math.floor(s%3600/60)} 分 ${s%60} 秒`;}
export function musicPeriod(mode,date=new Date()){
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(date),d=new Date(today+'T12:00:00Z');
 if(mode==='week')d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));else if(mode==='month')d.setUTCDate(1);else{d.setUTCMonth(0,1);}
 return {start:d.toISOString().slice(0,10),end:today};
}
export function libraryTracks(rows,user){const map=new Map();for(const row of rows){const old=map.get(row.track_key);if(!old||row.owner_user_id===user)map.set(row.track_key,row);}return [...map.values()];}
export function nextTrack(keys,key,step,mode,random=Math.random){if(!keys.length)return null;const index=keys.indexOf(key);if(mode==='single')return key||keys[0];if(mode==='shuffle'&&keys.length>1){const pool=keys.filter(k=>k!==key);return pool[Math.floor(random()*pool.length)];}return keys[(Math.max(0,index)+step+keys.length)%keys.length];}
export function lyricWords(tracks){
 const count=new Map(),ignore=new Set(['的','了','是','我','你','他','她','在','和','与','也','就','都','一','不','有','这','那','啊','着','the','a','i','you','and','to','of','it','is','in','my']);
 const segment=typeof Intl.Segmenter==='function'?new Intl.Segmenter('zh',{granularity:'word'}):null;
 for(const track of tracks)for(const line of track.lyrics||[]){const text=String(line.text||'').toLowerCase(),parts=segment?[...segment.segment(text)].filter(v=>v.isWordLike).map(v=>v.segment):text.match(/[\p{L}]{2,}/gu)||[];for(const word of parts)if(word.length>1&&!ignore.has(word))count.set(word,(count.get(word)||0)+1);}
 return [...count].sort((a,b)=>b[1]-a[1]).slice(0,16);
}
