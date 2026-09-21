import { validDate, localDate, displayDay, projectMessages } from './core.js?v=2.3.0';

export const MAX_FILE_SIZE = 20 * 1024 * 1024;
const allowed = new Set(['image/jpeg','image/png','image/webp','image/gif','audio/mpeg','audio/mp4','audio/ogg','audio/wav','audio/x-wav','audio/webm','audio/flac','video/mp4','video/webm','application/pdf','text/plain','application/zip','application/x-zip-compressed','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation']);
const byExtension = {jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',mp3:'audio/mpeg',m4a:'audio/mp4',ogg:'audio/ogg',wav:'audio/wav',flac:'audio/flac',mp4:'video/mp4',webm:'video/webm',pdf:'application/pdf',txt:'text/plain',zip:'application/zip',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',ppt:'application/vnd.ms-powerpoint',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation'};
export function fileInfo(file) {
  if (!file || !file.size || file.size > MAX_FILE_SIZE) throw new Error('请选择不超过 20 MB 的非空文件。');
  const ext = String(file.name).split('.').pop().toLowerCase();
  const type=String(file.type||'').split(';')[0];
  const mime = allowed.has(type) ? type : (!type || type === 'application/octet-stream') ? byExtension[ext] : '';
  if (!mime || !allowed.has(mime)) throw new Error('支持常见图片、音视频、PDF、TXT、Office 和 ZIP 文件。');
  return {name: String(file.name).replace(/[\x00-\x1f\\/]/g,'_').slice(0,180) || '附件',mime,size:file.size,type:mime.startsWith('image/')?'image':mime.startsWith('audio/')?'audio':mime.startsWith('video/')?'video':'file'};
}
export function mediaPathValid(path, room) {
  return typeof path === 'string' && path.split('/')[0] === room && /^v2_[A-Za-z0-9_-]+\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/.test(path);
}
export function bytesLabel(bytes) { return bytes < 1024*1024 ? `${Math.ceil(bytes/1024)} KB` : `${(bytes/1024/1024).toFixed(1)} MB`; }
function utcDay(date) { return Date.parse(date+'T00:00:00Z') / 86400000; }
export function daysBetween(from, to = localDate()) { return validDate(from) && validDate(to) ? Math.round(utcDay(to)-utcDay(from)) : null; }
export function eventCountdown(event, today = localDate()) {
  if (!validDate(event.event_date) || !validDate(today)) return null;
  let date = event.event_date;
  if (event.repeat_yearly && date < today) {
    let year = Number(today.slice(0,4));
    const atYear = y => {
      let value = `${y}${date.slice(4)}`;
      if (!validDate(value) && date.slice(5) === '02-29') value = `${y}-02-28`;
      return value;
    };
    date = atYear(year);
    if (date < today) date = atYear(++year);
  }
  return {date,days:daysBetween(today,date)};
}
export function parseLyrics(text) {
  const offset = Number(String(text).match(/\[offset:([+-]?\d+)\]/i)?.[1] || 0)/1000;
  const rows=[];
  for (const line of String(text).slice(0,200000).split(/\r?\n/)) {
    const stamps=[...line.matchAll(/\[(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?\]/g)];
    const words=line.replace(/\[[^\]]*\]/g,'').trim();
    for(const stamp of stamps) rows.push({time:Math.max(0,Number(stamp[1])*60+Number(stamp[2])+Number('0.'+(stamp[3]||'0'))+offset),text:words});
  }
  return rows.sort((a,b)=>a.time-b.time);
}
export function activeLyric(rows, time) {
  let low=0, high=rows.length-1, found=-1;
  while(low<=high){const mid=(low+high)>>1;if(rows[mid].time<=time){found=mid;low=mid+1;}else high=mid-1;}
  return found;
}
export function playbackPosition(session, now=Date.now(), duration=Infinity) {
  const position=Number(session?.position_seconds)||0;
  const age=session?.is_playing ? Math.max(0,(now-Date.parse(session.updated_at))/1000) : 0;
  return Math.max(0,Math.min(Number.isFinite(duration)?duration:86400,position+(Number.isFinite(age)?age:0)));
}
export function memoirText(messages, start, end, authorName) {
  if (!validDate(start)||!validDate(end)||start>end) throw new Error('请选择有效的起止日期。');
  const rows=projectMessages(messages,'diary').filter(m=>{const day=displayDay(m,'diary');return day>=start&&day<=end;});
  if(!rows.length) throw new Error('这个日期范围还没有留言。');
  const output=[`# ${start} — ${end}`,`\n收录 ${rows.length} 条留言。以下是按日期整理的原文，可继续改写。`];
  let day='';
  for(const row of rows){
    const next=displayDay(row,'diary');
    if(day!==next){day=next;output.push('\n## '+day);}
    const text=[row.import_label?`[截图摘录：${row.import_label}]`:'',row.content,row.media_name?`[附件：${row.media_name}]`:''].filter(Boolean).join('\n');
    output.push(`\n${authorName(row)}：\n${text}`);
  }
  const body=output.join('\n');
  if(body.length>200000) throw new Error('内容超过 20 万字，请缩小日期范围。');
  return {body,count:rows.length};
}
