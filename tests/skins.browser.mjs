import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
function audioFile(){const n=8000*45,b=Buffer.alloc(44+n*2);b.write('RIFF');b.writeUInt32LE(36+n*2,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);for(let i=0;i<n;i++)b.writeInt16LE(Math.round(Math.sin(i*220/8000)*400),44+i*2);return b;}
export async function runSkins({setup,check,secureId,user,friend,fixture,root}){
 const themes=['ins-light','ins-dark','warm-light','warm-dark','rain-night','moon-glass'];
 const photo=await readFile(root+'/assets/skins/warm-day.webp'),path=secureId+'/'+user+'/00000000-0000-4000-a000-000000000090';
 const s=await setup({secure:true,uploads:[[path,{buffer:photo,mime:'image/webp'}]],rows:[
  fixture(1,secureId,'今天窗边的光，想分给你一点。',user,{author_id:user,message_type:'image',media_path:path,media_mime:'image/webp',media_name:'窗边.webp',media_size:photo.length,display_date:'2026-09-20'}),
  fixture(2,secureId,'等雨停下，我们去散步吧。',friend,{author_id:friend,display_date:'2026-09-21'}),
  fixture(3,secureId,'今天的风很轻。回去的路上又听了一遍那首歌。',user,{author_id:user,display_date:'2026-09-22'}),
  fixture(4,secureId,'记得吃晚饭呀。',friend,{author_id:friend,display_date:'2026-09-23'})
 ]}),p=s.page;
 await p.waitForFunction(()=>document.querySelector('#roomStatus').textContent.includes('左滑'));
 s.control.daily.space_entries.push({id:'skin-todo',revision:1,room_id:secureId,owner_user_id:user,kind:'todo',title:'一起读两页飞鸟集',body:'',visibility:'shared',event_date:'2026-10-03',created_at:'2026-10-02T20:00:00Z',data:{done:false,remind:false}});
 s.control.daily.pockets.push({id:'skin-pocket',room_id:secureId,owner_user_id:user,title:'我们的旅行基金',target_cents:100000,daily_cents:1000,mode:'daily',qr_path:path,cover_path:null,note:'一点一点，去看更远的风景。',created_at:'2026-09-01T00:00:00Z'});
 s.control.daily.pocket_entries.push({id:'skin-deposit',pocket_id:'skin-pocket',room_id:secureId,owner_user_id:user,kind:'deposit',cents:35800,status:'settled',reason:'把今天的期待存起来。',created_at:new Date().toISOString()});
 await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
 const theme=async value=>p.evaluate(async t=>(await import('./ui-v2.js?v=2.6.1')).setTheme(t),value);
 const shot=async name=>{await p.waitForTimeout(280);await p.evaluate(()=>document.fonts.ready);await p.screenshot({path:root+'/test-results/skin-'+name+'.png'});};
 await check('each skin loads its photograph and the real handwritten Chinese font',async()=>{
  await p.locator('#relationHandle').click();await p.locator('#listenBtn').click();
  await p.locator('#listenFile').setInputFiles({name:'晚风的来信.wav',mimeType:'audio/wav',buffer:audioFile()});await p.waitForFunction(()=>!document.querySelector('#listenToggle').disabled);
  await p.locator('#lyricsFile').setInputFiles({name:'晚风.lrc',mimeType:'text/plain',buffer:Buffer.from('[00:00.00]今天的风很轻\n[00:05.00]窗边有一束光\n[00:12.00]还有些话想慢慢讲\n[00:20.00]等你有空再听')});
  await p.locator('#musicLike').click();await p.waitForFunction(()=>document.querySelectorAll('#trackLikes .music-like-note.is-liked').length===1);
  const key=s.control.music.music_tracks[0].track_key;s.control.music.music_likes.push({room_id:secureId,owner_user_id:friend,track_key:key});
  s.control.music.music_tracks[0].artist='一封没有寄出的信';s.control.music.music_tracks[0].genre='轻音乐';
  s.control.music.music_playlists.push({id:'skin-list',room_id:secureId,owner_user_id:user,title:'散步时听',visibility:'shared',track_keys:[key]});
  s.control.musicReport={daily:[{day:'2026-09-16',seconds:22356},{day:'2026-09-20',seconds:5800},{day:'2026-09-24',seconds:14340}],tracks:[{track_key:key,plays:12,seconds:42496,last_played:'2026-09-24T12:00:00Z'}],total_seconds:42496};
  await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await p.waitForFunction(()=>document.querySelectorAll('#trackLikes .music-like-note.is-liked').length===2);
  await p.locator('#musicImport').evaluate(e=>e.open=false);
  for(const t of themes){await theme(t);await p.evaluate(async()=>{const src=getComputedStyle(document.documentElement).getPropertyValue('--scene').match(/url\(['"]?([^'")]+)/)[1];await new Promise((resolve,reject)=>{const im=new Image();im.onload=resolve;im.onerror=reject;im.src=src;});await document.fonts.load('18px "Mailbox WenKai"','回忆墙');});assert.ok(await p.evaluate(()=>document.fonts.check('18px "Mailbox WenKai"','回忆墙')));await p.locator('#spacePages').evaluate(e=>e.scrollTop=0);await shot('music-'+t);}
  await theme('ins-light');await p.locator('[data-music-page=library]').click();await shot('library');
  await p.locator('[data-music-page=report]').click();await p.locator('#reportDate').fill('2026-09-30');await p.locator('#reportDate').dispatchEvent('change');await p.waitForFunction(()=>document.querySelectorAll('.music-report-tile').length===4);await shot('report');
  await p.locator('[data-music-page=player]').click();await p.locator('#musicRecord').click();await shot('lyrics');await p.locator('#lyricsBack').click();await p.locator('#relationClose').click();
 });
 await check('landscape docks operate the existing player and live todo, and hide alongside feature panels',async()=>{
  await p.setViewportSize({width:1440,height:960});await theme('moon-glass');await p.locator('#sceneTodoList .scene-todo').waitFor();await shot('moon-desktop');
  await p.locator('#scenePlay').click();await p.waitForFunction(()=>!document.querySelector('#listenAudio').paused);await p.locator('#scenePlay').click();assert.equal(await p.locator('#listenAudio').evaluate(e=>e.paused),true);
  await p.locator('#sceneSeek').evaluate(e=>e.value='12');await p.locator('#sceneSeek').dispatchEvent('change');await p.waitForFunction(()=>Math.abs(document.querySelector('#listenAudio').currentTime-12)<.5);
  await p.locator('#sceneLike').click();await p.waitForFunction(()=>document.querySelector('#musicLike').getAttribute('aria-pressed')==='false');await p.locator('#sceneLike').click();await p.waitForFunction(()=>document.querySelector('#musicLike').getAttribute('aria-pressed')==='true');
  await p.locator('#sceneMode').click();assert.equal(await p.locator('#sceneMode').getAttribute('aria-label'),await p.locator('#musicMode').textContent());
  await p.locator('#sceneTodoList .scene-todo').click();await p.waitForFunction(()=>document.querySelector('#sceneTodoList .scene-todo')?.getAttribute('aria-checked')==='true');assert.equal(s.control.daily.space_entries.find(e=>e.id==='skin-todo').data.done,true);
  await p.locator('#sceneMusicOpen').click();await p.locator('#listenScrim').waitFor({state:'visible'});assert.equal(await p.locator('#listenScrim').isVisible(),true);assert.equal(await p.locator('.scene-dock').isVisible(),false);await p.locator('#relationClose').click();
  await p.locator('.scene-shortcuts [data-scene-target=wall]').click();await p.locator('#wallSpace').waitFor({state:'visible'});assert.equal(await p.locator('#messages .msg').count(),4);await p.locator('#relationClose').click();
  await theme('rain-night');await shot('rain-desktop');
  await p.setViewportSize({width:1180,height:820});await shot('rain-tablet');await theme('moon-glass');await shot('moon-tablet');
  for(const width of [980,1024,1180,1440]){await p.setViewportSize({width,height:900});await p.locator('#relationHandle').click();await p.waitForTimeout(260);assert.ok((await p.locator('#chatColumn').boundingBox()).width>=300,'chat remains readable at '+width);assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.locator('#relationClose').click();}
 });
 await check('paper, acrylic and savings treatments show real stored content in all six skins',async()=>{
  await p.setViewportSize({width:390,height:844});
  for(const t of themes){await theme(t);await p.locator('#relationHandle').click();await p.locator('[data-open-view=wall]').click();await p.locator('[data-memory-mode=notes]').click();await p.waitForFunction(()=>document.querySelector('.memory-card img')?.naturalWidth>0);await shot('notes-'+t);await p.locator('[data-memory-mode=disc]').click();await shot('disc-'+t);await p.locator('#spaceBack').click();await p.locator('#pocketSpaceBtn').click();await p.locator('.pocket-goal-card').waitFor();await shot('pocket-'+t);await p.locator('#relationClose').click();}
  await theme('warm-light');await p.locator('#relationHandle').click();await p.locator('#pocketSpaceBtn').click();await p.getByRole('button',{name:'＋ 存一笔',exact:true}).click();await p.locator('.pocket-quick-amounts').getByRole('button',{name:'+ 50',exact:true}).click();assert.equal(await p.locator('#pocketSpace [name=amount]').inputValue(),'50');await shot('deposit');await p.getByRole('button',{name:'取消',exact:true}).click();
  await p.getByRole('button',{name:'写假条',exact:true}).click();await shot('leave');await p.getByRole('button',{name:'取消',exact:true}).click();
  await p.locator('#spaceBack').click();await p.locator('[data-open-view=wall]').click();await p.locator('[data-memory-mode=board]').click();await shot('clue-board');
  await p.locator('[data-memory-mode=notes]').click();await p.locator('#memorySelect').click();await p.locator('#memorySelectAll').click();await p.locator('#memoryFilmAdd').click();await p.locator('#filmFrames img').waitFor();await shot('film-editor');await p.locator('#filmPreview').click();await p.locator('#filmPlay').click();await p.locator('#filmTimeline button').last().click();assert.equal(Number(await p.locator('#filmProjector').getAttribute('data-index')),await p.locator('#filmTimeline button').count()-1);await shot('film-projector');await p.locator('#filmTimeline button').nth(4).click();await p.waitForFunction(()=>document.querySelector('#filmScene img')?.naturalWidth>0);await p.locator('#spacePages').evaluate(e=>e.scrollTop=0);await shot('film-photo');
 });
 assert.deepEqual(s.errors,[]);await s.context.close();
}
