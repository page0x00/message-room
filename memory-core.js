import {displayDay,localDate} from './core.js?v=2.7.7';
export function memoryCollection({messages=[],entries=[],events=[],listens=[],profile={}}){
 const rows=[],annotations=profile.data?.annotations||{};
 for(const m of messages){const media=m.media_path?[{path:m.media_path,type:m.message_type,mime:m.media_mime,name:m.media_name,size:m.media_size}]:[];rows.push({id:'message:'+m.id,kind:media[0]?.type||'text',date:displayDay(m,'wall'),title:'',body:m.message_payload?.entries?.map(e=>(e.label?e.label+'：':'')+(e.text||'')).join('\n')||m.content||'',media,owner:m.author_id,source:m});}
 for(const e of entries.filter(e=>['diary','memory'].includes(e.kind)))rows.push({id:'entry:'+e.id,kind:e.kind,date:e.event_date,title:e.title,body:e.body,media:e.data.media||[],tags:e.data.tags||[],mood:e.data.mood||'',private:e.visibility==='private',owner:e.owner_user_id,source:e});
 for(const e of events)rows.push({id:'event:'+e.id,kind:'anniversary',date:e.event_date,title:e.title,body:e.note||'值得记住的一天',media:[],owner:e.owner_user_id,source:e});
 for(const e of listens)rows.push({id:'music:'+e.day,kind:'music',date:e.day,title:'一起听过的时光',body:`一起听了 ${Math.floor(e.seconds/3600)} 小时 ${Math.floor(e.seconds%3600/60)} 分 ${Math.floor(e.seconds%60)} 秒`,media:[],source:e});
 const unique=[...new Map(rows.map(r=>[r.id,{...r,...annotations[r.id],tags:[...new Set([...(r.tags||[]),...(annotations[r.id]?.tags||[])])]}])).values()];
 return unique.sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
}
export function memoryLinks(rows,manual=[]){
 const links=new Map(),byId=new Map(rows.map(r=>[r.id,r]));
 function add(a,b,label){if(a===b||!byId.has(a)||!byId.has(b))return;const id=[a,b].sort().join('|'),old=links.get(id);if(old&&!old.label.includes(label))old.label+=' · '+label;else if(!old)links.set(id,{from:a,to:b,label});}
 for(let i=1;i<rows.length;i++){const a=rows[i];for(const type of ['date','location','event','people','tags']){const b=rows.slice(0,i).reverse().find(b=>type==='people'||type==='tags'?(a[type]||[]).some(v=>(b[type]||[]).includes(v)):a[type]&&a[type]===b[type]);if(b)add(a.id,b.id,({date:'同一天',location:'同地点',event:'同一事件',people:'同一人物',tags:'同标签'})[type]);}}
 for(const l of manual)add(l.from,l.to,l.label||'主动关联');return [...links.values()];
}
export function todaySummary(rows,today=localDate()){const selected=rows.filter(r=>r.date===today);if(!selected.length)return null;return {id:'summary:'+today,kind:'summary',date:today,title:'今日回忆小结',body:`今天留下了 ${selected.length} 条回忆。\n`+selected.slice(0,5).map(r=>(r.title||r.body).slice(0,70)).join('\n'),media:[],sources:selected.map(r=>r.id)};}
export function discIndex(angle,count){return count?((Math.round(angle/30)%count)+count)%count:0;}
export function normalizeFrames(frames){if(!Array.isArray(frames))return [];return frames.filter(f=>typeof f.source==='string'&&/^(message|entry|event|music|summary):/.test(f.source)).map(f=>({source:f.source,seconds:Math.min(60,Math.max(1,Number(f.seconds)||4))})).slice(0,300);}
