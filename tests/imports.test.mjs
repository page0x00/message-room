import test from 'node:test';
import assert from 'node:assert/strict';
import {screenshotTime,sortScreenshots,slices,chatDate,dateMessages,mergeTileRows,bubbleRegions} from '../ocr-layout.js';
import {importUnits,selectedDrafts,directoryFiles} from '../import-core.js';
import {forwardUnits} from '../message-actions.js';

test('filename capture time wins over copied file mtime and sorts numerically',()=>{
 const a={name:'Screenshot_20260921_100400.jpg',lastModified:1},b={name:'Screenshot_20260920_235959.png',lastModified:Date.now()};assert.equal(new Date(screenshotTime(a)).getFullYear(),2026);assert.deepEqual(sortScreenshots([a,b]),[b,a]);assert.equal(screenshotTime({name:'image.png',lastModified:1234}),1234);
});
test('long screenshots keep full height with bounded overlapping tiles',()=>{
 const rows=slices(18000,1080);assert.ok(rows.length>7);assert.equal(rows[0].y,0);assert.equal(rows.at(-1).y+rows.at(-1).height,18000);for(let i=0;i<rows.length;i++){assert.ok(rows[i].height<=2200);if(i)assert.ok(rows[i].y<rows[i-1].y+rows[i-1].height);}
});
test('date separators carry real dates; body dates are never consumed as separators',()=>{
 assert.equal(chatDate('2024年9月4日 下午 20:02','2026-09-21')?.date,'2024-09-04');assert.equal(chatDate('昨天 20:02','2026-09-21').date,'2026-09-20');assert.equal(chatDate('12月31日','2026-01-02').date,'2025-12-31');assert.equal(chatDate('我们在9月4日见面','2026-09-21'),null);
 const rows=dateMessages([{text:'2024年9月4日',side:'unknown',kind:'date',y:50,x:100},{text:'09:42',side:'unknown',kind:'date',y:80,x:100},{text:'9月5日',side:'left',kind:'bubble',y:100,x:20}], '2026-09-21');assert.equal(rows.length,1);assert.equal(rows[0].text,'9月5日');assert.equal(rows[0].date,'2024-09-04');assert.equal(rows[0].time,'09:42');assert.equal(dateMessages([{text:'正文',side:'left',y:20,x:10}],'2026-09-21')[0].dateSource,'截图日期（未见聊天日期）');
});
test('tile overlap reconstructs one bubble without dropping repeated messages elsewhere',()=>{
 const line=(text,y,confidence=90)=>({text,y,height:20,confidence});const rows=mergeTileRows([{text:'第一行\n第二行',side:'left',kind:'bubble',x:70,y:1800,height:190,lines:[line('第一行',1810),line('第二行',1900)],confidence:90},{text:'第二行\n第三行',side:'left',kind:'bubble',x:72,y:1880,height:180,lines:[line('第二行',1901),line('第三行',2000)],confidence:91},{text:'第二行',side:'left',kind:'bubble',x:70,y:2500,height:40,confidence:90}]);assert.equal(rows.length,2);assert.equal(rows[0].text,'第一行第二行第三行');assert.equal(rows[1].text,'第二行');
});
test('merged imports keep sender attribution, dates and media; large text never truncates',()=>{
 const rows=[{nonce:'a',label:'朋友',text:'甲'.repeat(5000),date:'2024-01-01',side:'left'},{nonce:'b',label:'我',text:'乙',date:'2024-01-02',side:'right'},{nonce:'c',label:'朋友',text:'附件',date:'2024-01-02',side:'left',fileMeta:{name:'note.txt'}}];const units=importUnits(rows,'merged');assert.ok(units.length>=4);assert.ok(units.every(u=>u.text.length<5000));assert.equal(units.map(u=>u.text).join('').split('甲').length-1,5000);assert.equal(units.at(-1).fileRow,'c');assert.deepEqual(selectedDrafts(rows,'right').map(r=>r.nonce),['b']);assert.equal(units.find(u=>u.rows.includes('b')).date,'2024-01-02');
});
test('directory traversal includes nested screenshots but no unrelated files',async()=>{
 const f=name=>({kind:'file',name,getFile:async()=>({name,type:'',size:10})});const folder={async* values(){yield f('b.png');yield {kind:'directory',name:'earlier',async* values(){yield f('a.jpg');yield f('notes.txt');}};}};const rows=[];for await(const row of directoryFiles(folder))rows.push(row.path);assert.deepEqual(rows,['b.png','earlier/a.jpg']);
});
test('forwarding preserves chronology, source text and media without mutating originals',()=>{
 const rows=[{id:'2',created_at:'2026-09-21',content:'later',display_date:null},{id:'1',created_at:'2026-09-20',content:'first',display_date:'2024-01-01'},{id:'3',created_at:'2026-09-22',content:'audio',media_path:'room/owner/file'}],original=JSON.stringify(rows);const merged=forwardUnits(rows,'merged',()=> '朋友');assert.equal(merged.length,2);assert.ok(merged[0].content.indexOf('first')<merged[0].content.indexOf('later'));assert.match(merged[0].content,/2024-01-01/);assert.equal(merged[1].source.media_path,'room/owner/file');assert.equal(forwardUnits(rows,'separate',()=> '我').length,3);assert.equal(JSON.stringify(rows),original);
});
