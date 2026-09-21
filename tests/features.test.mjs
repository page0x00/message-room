import test from 'node:test';
import assert from 'node:assert/strict';
import {fileInfo,MAX_FILE_SIZE,mediaPathValid,daysBetween,eventCountdown,parseLyrics,activeLyric,playbackPosition,memoirText,ocrDrafts} from '../feature-core.js';
test('attachment allowlist excludes executable previews and oversize files',()=>{
  assert.equal(fileInfo({name:'照片.PNG',type:'',size:12}).type,'image');
  for(const file of [{name:'x.svg',type:'image/svg+xml',size:12},{name:'x.html',type:'text/html',size:12},{name:'x.png',type:'image/png',size:MAX_FILE_SIZE+1},{name:'x.png',type:'image/png',size:0}])assert.throws(()=>fileInfo(file));
});
test('attachment names and paths cannot escape room scope',()=>{
  assert.equal(fileInfo({name:'../../x.png',type:'image/png',size:1}).name,'.._.._x.png');
  const path=`v2_abcd/${crypto.randomUUID()}/${crypto.randomUUID()}`;
  assert.equal(mediaPathValid(path,'v2_abcd'),true);assert.equal(mediaPathValid(path,'v2_efgh'),false);assert.equal(mediaPathValid(path+'/../a','v2_abcd'),false);
});
test('calendar counts whole calendar days and honors leap dates',()=>{
  assert.equal(daysBetween('2024-02-28','2024-03-01'),2);assert.equal(daysBetween('2026-02-30','2026-03-01'),null);
  assert.deepEqual(eventCountdown({event_date:'2024-02-29',repeat_yearly:true},'2025-02-27'),{date:'2025-02-28',days:1});
  assert.deepEqual(eventCountdown({event_date:'2024-09-04',repeat_yearly:true},'2026-09-04'),{date:'2026-09-04',days:0});
  assert.equal(eventCountdown({event_date:'2024-09-04',repeat_yearly:false},'2026-09-04').days<0,true);
});
test('LRC supports repeat timestamps, milliseconds and offset',()=>{
  const rows=parseLyrics('[ar:歌手]\n[offset:-500]\n[00:01.20][01:02.345] hello\n[00:05]world');
  assert.deepEqual(rows,[{time:0.7,text:'hello'},{time:4.5,text:'world'},{time:61.845,text:'hello'}]);
  assert.equal(activeLyric(rows,.6),-1);assert.equal(activeLyric(rows,60),1);assert.equal(activeLyric([],10),-1);
});
test('listening applies server elapsed time only when playing and clamps duration',()=>{
  const now=Date.parse('2026-09-20T10:00:05Z'),row={updated_at:'2026-09-20T10:00:00Z',position_seconds:10,is_playing:true};
  assert.equal(playbackPosition(row,now,12),12);assert.equal(playbackPosition({...row,is_playing:false},now),10);assert.equal(playbackPosition({...row,updated_at:'2026-09-21T10:00:00Z'},now),10);
});
test('memoir includes display dates and source attribution without changing messages',()=>{
  const messages=[{id:'1',content:'晚霞',created_at:'2026-09-20T10:00:00Z',display_date:'2026-09-04',import_label:'旧截图',media_name:'夕阳.png'},{id:'2',content:'排除',created_at:'2026-09-20T10:00:00Z'}];
  const original=JSON.stringify(messages),result=memoirText(messages,'2026-09-04','2026-09-04',()=> '我');
  assert.equal(result.count,1);assert.match(result.body,/旧截图/);assert.match(result.body,/夕阳.png/);assert.doesNotMatch(result.body,/排除/);assert.equal(JSON.stringify(messages),original);assert.throws(()=>memoirText(messages,'2026-09-30','2026-09-04',()=>''));
});
test('OCR drafts preserve recognized text and suggest editable source sides',()=>{
  const data={blocks:[{paragraphs:[{bbox:{x0:0,x1:180},lines:[{text:'你好'},{text:'到啦'}]},{bbox:{x0:240,x1:400},text:'欢迎'}]}]};
  assert.deepEqual(ocrDrafts(data,400,'朋友','我'),[{text:'你好\n到啦',label:'朋友'},{text:'欢迎',label:'我'}]);
  assert.deepEqual(ocrDrafts({text:'一段\n\n二段'},400),[{text:'一段',label:'截图'},{text:'二段',label:'截图'}]);
  assert.throws(()=>ocrDrafts({text:'x'.repeat(5001)},400));
});
