import {memoryControl} from './memory-controls.mjs';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
export async function runFilms({setup,check,secureId,user,friend,fixture,root}){
 const path=secureId+'/'+user+'/00000000-0000-4000-a000-000000000099',photo=await readFile(root+'/assets/icon-512.png');
 const s=await setup({secure:true,uploads:[[path,{buffer:photo,mime:'image/png'}]],rows:[fixture(1,secureId,'海边的那张照片',user,{author_id:user,message_type:'image',media_path:path,media_mime:'image/png',media_name:'海边.png',media_size:photo.length,display_date:'2026-09-20'}),fixture(2,secureId,'晚风和你，都刚刚好。',friend,{author_id:friend,display_date:'2026-09-21'}),fixture(3,secureId,'记住我们说过的话。',user,{author_id:user,display_date:'2026-09-22'})]}),p=s.page;
 s.control.uploads.set(path,{buffer:photo,mime:'image/png'});
 await p.waitForFunction(()=>document.querySelector('#roomStatus').textContent.includes('左滑'));await p.locator('#relationHandle').click();await p.locator('[data-open-view=wall]').click();
 await check('select actual memories, edit frame durations and order, then save a private referenced film',async()=>{
  await memoryControl(p,'#memorySelect');await p.locator('#memorySelectAll').click();await p.locator('#memoryFilmAdd').click();await p.locator('#filmFrames [data-frame="2"]').waitFor();
  await p.locator('#filmTitle').fill('把晚风装进胶片');await p.locator('#filmFrames [data-frame="0"] input').fill('2');await p.locator('#filmFrames [data-frame="0"] input').dispatchEvent('change');
  const first=await p.locator('#filmFrames [data-frame="0"] p').textContent();await p.locator('#filmFrames [data-frame="0"]').getByRole('button',{name:'↓',exact:true}).click();assert.equal(await p.locator('#filmFrames [data-frame="1"] p').textContent(),first);
  await p.locator('#filmSave').click();await p.waitForFunction(()=>document.querySelector('#filmSaveStatus').textContent.includes('已保存'));assert.equal(s.control.memoryFilms.length,1);assert.equal(s.control.memoryFilms[0].owner_user_id,user);assert.equal(s.control.memoryFilms[0].frames[1].seconds,2);assert.ok(s.control.memoryFilms[0].frames.every(f=>!('body' in f)));
 });
 await check('film actually loads photo pixels, renders changing grain and advances with mechanical audio',async()=>{
  await p.locator('#filmPreview').click();await p.locator('#filmProjector').waitFor({state:'visible'});await p.locator('#filmPlay').click();
  // Move to the real photo frame; pause leaves a stable index for pixel inspection.
  const i=s.control.memoryFilms[0].frames.findIndex(f=>f.source==='message:1');for(let n=0;n<i;n++)await p.locator('#filmNext').click();
  await p.waitForFunction(()=>document.querySelector('#filmScene img')?.naturalWidth>0);assert.match(await p.locator('#filmScene img').getAttribute('src'),/^blob:/);
  const before=await p.locator('#filmGrain').evaluate(e=>e.toDataURL());await p.waitForTimeout(120);assert.notEqual(await p.locator('#filmGrain').evaluate(e=>e.toDataURL()),before);
  await p.locator('#filmSound').selectOption('immersive');await p.waitForTimeout(160);await p.locator('#spacePages').evaluate(e=>e.scrollTop=0);await p.screenshot({path:root+'/test-results/film-photo-phone.png'});
  await p.locator('#filmPrev').click();assert.equal(Number(await p.locator('#filmProjector').getAttribute('data-index')),Math.max(0,i-1));
 });
 await check('opening a frame shows its original detail, pauses playback and preserves the same frame on return',async()=>{
  const before=await p.locator('#filmProjector').getAttribute('data-index');await p.locator('#filmDetailOpen').click();await p.locator('#filmDetail').waitFor({state:'visible'});assert.ok((await p.locator('#filmDetail .memory-full-text').first().textContent()).length>0);assert.equal(await p.locator('#filmBgmAudio').evaluate(e=>e.paused),true);assert.equal(await p.locator('#filmProjector').isVisible(),false);await p.locator('#filmDetail').getByRole('button',{name:'‹ 继续看这一幕',exact:true}).click();assert.equal(await p.locator('#filmProjector').getAttribute('data-index'),before);assert.equal(await p.locator('#filmPlay').textContent(),'播放');
 });
 await check('held rewind traverses backwards and release stops precisely; keyboard click toggles rewind',async()=>{
  for(let n=0;n<3;n++)await p.locator('#filmNext').click();assert.equal(await p.locator('#filmProjector').getAttribute('data-index'),'2');
  const b=await p.locator('#filmRewind').boundingBox();await p.mouse.move(b.x+b.width/2,b.y+b.height/2);await p.mouse.down();await p.waitForTimeout(210);await p.mouse.up();await p.waitForTimeout(40);
  const stopped=await p.locator('#filmProjector').getAttribute('data-index');assert.ok(Number(stopped)<2);await p.waitForTimeout(220);assert.equal(await p.locator('#filmProjector').getAttribute('data-index'),stopped);assert.equal(await p.locator('#filmProjector').evaluate(e=>e.classList.contains('rewinding')),false);
  await p.locator('#filmNext').click();await p.locator('#filmNext').click();await p.locator('#filmRewind').focus();await p.keyboard.press('Enter');await p.waitForTimeout(190);await p.keyboard.press('Enter');assert.equal(await p.locator('#filmPlay').textContent(),'播放');
 });
 await check('video memories play real decoded media and pause along with the projector',async()=>{
  await p.locator('#filmExit').click();
  const bytes=await p.evaluate(async()=>{const canvas=document.createElement('canvas');canvas.width=160;canvas.height=120;const c=canvas.getContext('2d'),stream=canvas.captureStream(12),recorder=new MediaRecorder(stream,{mimeType:'video/webm'}),chunks=[];recorder.ondataavailable=e=>chunks.push(e.data);const done=new Promise(resolve=>recorder.onstop=resolve);recorder.start();let i=0;const timer=setInterval(()=>{c.fillStyle=i++%2?'#b39a73':'#53646b';c.fillRect(0,0,160,120);c.fillStyle='#f6eddb';c.fillRect(30+i%30,40,35,35);},80);await new Promise(resolve=>setTimeout(resolve,1000));recorder.stop();await done;clearInterval(timer);stream.getTracks().forEach(t=>t.stop());return [...new Uint8Array(await new Blob(chunks).arrayBuffer())];});
  const videoPath=secureId+'/'+user+'/00000000-0000-4000-a000-000000000098';s.control.uploads.set(videoPath,{buffer:Buffer.from(bytes),mime:'video/webm'});s.control.records.push(fixture(4,secureId,'会动的回忆',user,{author_id:user,message_type:'video',media_path:videoPath,media_size:bytes.length,media_mime:'video/webm',media_name:'movement.webm',display_date:'2026-09-23'}));
  await p.locator('#filmAdd').click();await memoryControl(p,'[data-memory-mode=notes]');const card=p.locator('[data-memory-id="message:4"]');await card.waitFor();await card.locator('input').check();await p.locator('#memoryFilmAdd').click();await p.locator('#filmFrames [data-frame="3"]').waitFor();await p.locator('#filmPreview').click();await p.locator('#filmProjector').waitFor({state:'visible'});for(let n=0;n<3;n++)await p.locator('#filmNext').click();await p.waitForFunction(()=>document.querySelector('#filmScene video')?.currentTime>.1);assert.equal(await p.locator('#filmScene video').evaluate(e=>e.videoWidth),160);await p.locator('#filmPlay').click();assert.equal(await p.locator('#filmScene video').evaluate(e=>e.paused),true);
 });
 await check('leaving film panel stops playback and all themes and screen sizes retain usable controls',async()=>{
  await p.locator('#filmPlay').click();await p.locator('#spaceBack').click();assert.equal(await p.locator('#filmProjector').isVisible(),false);assert.equal(await p.locator('#filmBgmAudio').evaluate(e=>e.paused),true);
  await p.locator('#filmSpaceBtn').click();
  for(const [w,h] of [[390,844],[844,390],[820,1180],[1180,820],[1440,900]]){await p.setViewportSize({width:w,height:h});for(const theme of ['ins-light','ins-dark','warm-light','warm-dark','rain-night','moon-glass']){await p.evaluate(async t=>(await import('./ui-v2.js?v=2.7.6')).setTheme(t),theme);assert.ok(await p.locator('#filmSpace').evaluate(e=>e.scrollWidth<=e.clientWidth+1),theme+' '+w);}}
  await p.locator('#filmPreview').click();await p.locator('#filmProjector').waitFor({state:'visible'});await p.locator('#filmPlay').click();await p.screenshot({path:root+'/test-results/film-tablet.png'});await p.locator('#filmExit').click();
 });
 assert.deepEqual(s.errors,[]);await s.context.close();
}
