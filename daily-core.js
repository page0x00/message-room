import {localDate,validDate} from './core.js?v=2.3.0';
export function cents(value){const text=String(value).trim();if(!/^\d{1,8}(\.\d{1,2})?$/.test(text))throw new Error('金额最多保留两位小数。');const [a,b='']=text.split('.');const n=Number(a)*100+Number(b.padEnd(2,'0'));if(!n||n>9999999999)throw new Error('请输入有效金额。');return n;}
export const money=n=>(Number(n||0)/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
export function pocketBalance(rows){return rows.filter(r=>r.status==='settled').reduce((n,r)=>n+(r.kind==='deposit'?1:-1)*Number(r.cents),0);}
export function dayInShanghai(value=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));}
export function checkinStats(rows,goal,user,today=localDate()){
 const days=new Set(rows.filter(r=>r.kind==='checkin'&&r.data.goal===goal.id&&r.owner_user_id===user).map(r=>r.event_date));
 let t=Date.parse(today+'T12:00:00Z'),streak=0;if(!days.has(today))t-=86400000;
 while(days.has(new Date(t).toISOString().slice(0,10))){streak++;t-=86400000;}
 const from=goal.event_date,total=validDate(from)?Math.max(1,Math.round((Date.parse(today)-Date.parse(from))/86400000)+1):1;
 return {streak,completed:days.size,rate:Math.min(100,Math.round(days.size/total*100)),today:days.has(today)};
}
export function pocketToday(pocket,rows,leaves,members,today=dayInShanghai()){
 return members.map(m=>{const amount=rows.filter(r=>r.owner_user_id===m.user_id&&r.kind==='deposit'&&r.status==='settled'&&dayInShanghai(r.created_at)===today).reduce((a,r)=>a+Number(r.cents),0);const leave=leaves.find(r=>r.owner_user_id===m.user_id&&r.date_start<=today&&r.date_end>=today);return {user:m.user_id,name:m.display_name||'朋友',amount,leave,done:!!leave||pocket.mode==='free'||amount>=pocket.daily_cents};});
}
export function wheelValues(min,max,count){min=cents(min);max=cents(max);count=Number(count);if(min>max||!Number.isInteger(count)||count<2||count>24)throw new Error('范围从小到大，生成数量为 2～24。');return Array.from({length:count},()=>min+Math.floor(crypto.getRandomValues(new Uint32Array(1))[0]/4294967296*(max-min+1)));}
