import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
export async function runReference({setup,check,secureId,user,friend,fixture,root}){
 const themes=['ins-light','ins-dark','warm-light','warm-dark','rain-night','moon-glass'];
 const photo=await readFile(root+'/assets/skins/warm-day.webp'),path=secureId+'/'+user+'/00000000-0000-4000-a000-000000000091';
 const bodies=['今天窗边的光。','一起读完了一章。','院子里的花开了。','傍晚去散步。','周末的咖啡。','记下今天。','等雨停了再回家。','一起听了一首歌。'];
 const s=await setup({secure:true,touch:true,rows:bodies.map((text,i)=>fixture(i+1,secureId,text,i%2?friend:user,{author_id:i%2?friend:user,display_date:'2026-09-'+(24-Math.floor(i/2)),...(i%3===0?{message_type:'image',media_path:path,media_mime:'image/webp',media_name:'窗边.webp',media_size:photo.length}:{})})),uploads:[[path,{buffer:photo,mime:'image/webp'}]]}),p=s.page;
 const cdp=await s.context.newCDPSession(p);
 const open=async()=>{await p.locator('#relationHandle').click();await p.locator('[data-open-view=wall]').click();await p.locator('.memory-card').first().waitFor();};
 const mode=async value=>{await p.locator(`[data-memory-mode=${value}]`).click();await p.locator('.memory-stage').waitFor();await p.locator('#memoryZoomReset').click();};
 const shot=async name=>{await p.locator('#spacePages').evaluate(e=>e.scrollTop=0);await p.evaluate(()=>document.fonts.ready);const bounds=await p.evaluate(()=>{const a=document.querySelector('.memory-viewport'),b=document.querySelector('.memory-stage'),c=document.querySelector('.memory-optics');return {a:a.getBoundingClientRect().toJSON(),b:b.getBoundingClientRect().toJSON(),c:c.getBoundingClientRect().toJSON(),scroll:a.scrollTop};});assert.equal(bounds.scroll,0,'canvas wrapper must never scroll when focusing zoom controls');assert.ok(bounds.b.top>=bounds.a.top&&bounds.c.bottom<=bounds.a.bottom+1,'canvas and optics fit inside the panel');await p.screenshot({path:root+'/test-results/reference-'+name+'.png'});};
 await open();
 await check('cards and beam scale to the available device size, with identical geometry in every skin',async()=>{
  const columns=[];
  for(const [width,height] of [[360,780],[820,1180],[1440,900]]){
   await p.setViewportSize({width,height});await mode('notes');await p.waitForTimeout(100);
   let first;
   for(const theme of themes){
    await p.evaluate(async t=>(await import('./ui-v2.js?v=2.7.0')).setTheme(t),theme);
    const bounds=await p.evaluate(()=>{const stage=document.querySelector('.memory-stage'),card=document.querySelector('.memory-card');return {width:stage.clientWidth,height:stage.clientHeight,card:card.offsetWidth,columns:Number(stage.style.getPropertyValue('--memory-columns')),radius:parseFloat(stage.style.getPropertyValue('--light-radius'))};});
    assert.ok(bounds.card<250&&bounds.card>110);assert.ok(Math.abs(bounds.radius/Math.min(bounds.width,bounds.height)-.17)<.01);
    if(first)assert.deepEqual(bounds,first,'skin must not change layout');else first=bounds;
   }
   columns.push(first.columns);assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await p.evaluate(async()=>(await import('./ui-v2.js?v=2.7.0')).setTheme('ins-light'));
   await shot('notes-'+width);await mode('board');await shot('board-'+width);await mode('disc');await shot('disc-'+width);
  }
  assert.equal(columns[0],2);assert.ok(columns[1]>columns[0]);assert.ok(columns[2]>columns[1]);
 });
 await check('real two-finger input zooms all three canvases and cancels a pending clue-card drag',async()=>{
  await p.setViewportSize({width:390,height:844});
  for(const value of ['board','notes','disc']){
   await mode(value);await p.waitForTimeout(100);
   const positions=JSON.stringify(s.control.memoryProfiles[0]?.data.positions||{}),card=p.locator(value==='disc'?'.record-memory':'.memory-card').first(),r=await card.boundingBox(),stage=await p.locator('.memory-stage').boundingBox();
   const y=Math.min(stage.y+stage.height-100,r.y+55),a={x:r.x+25,y,id:1},b={x:stage.x+stage.width-90,y:y+90,id:2};
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[a]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...a,x:a.x+12,y:a.y+5}]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...a,x:a.x+12,y:a.y+5},b]});
   for(let i=1;i<=5;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...a,x:a.x+12-i*3,y:a.y+5-i*2},{...b,x:b.x+i*9,y:b.y+i*10}]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await p.waitForTimeout(100);
   assert.ok(Number(await p.locator('.memory-stage').getAttribute('data-zoom'))>125,value+' pinch zoom');
   assert.equal(JSON.stringify(s.control.memoryProfiles[0]?.data.positions||{}),positions,'pinch must not save the first finger as a drag');assert.equal(await p.locator('#memoryDetail').isVisible(),false);
   await p.locator('#memoryZoomReset').click();assert.equal(await p.locator('#memoryZoomReset').textContent(),'100%');
  }
 });
 await check('beam diameter persists, follows one finger and remains screen-relative after zoom and resize',async()=>{
  await mode('board');await p.locator('#memoryLight').click();await p.locator('#memoryBeam').fill('57');
  const measure=()=>p.locator('.memory-stage').evaluate(e=>parseFloat(e.style.getPropertyValue('--light-radius'))/Math.min(e.clientWidth,e.clientHeight));
  assert.ok(Math.abs(await measure()-.285)<.005);await p.locator('#memoryZoomIn').click();assert.ok(Math.abs(await measure()-.285)<.005);
  const r=await p.locator('.memory-stage').boundingBox();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:r.x+80,y:r.y+100,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:r.x+150,y:r.y+130,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.ok(await p.locator('.memory-stage').evaluate(e=>Math.abs(parseFloat(e.style.getPropertyValue('--light-x'))-150)<2));
  await p.setViewportSize({width:820,height:1180});await p.waitForTimeout(100);assert.ok(Math.abs(await measure()-.285)<.005);assert.equal(await p.locator('#memoryBeam').inputValue(),'57');await shot('flashlight-tablet');await p.locator('#memoryLight').click();
 });
 await check('poetry changes on each new visit, remains stable on theme changes and never replaces stored memories',async()=>{
  const before=await p.locator('.scene-hero-copy [data-poem]').getAttribute('data-poem-id'),original=JSON.stringify(s.control.records);
  await p.evaluate(async()=>(await import('./ui-v2.js?v=2.7.0')).setTheme('warm-light'));assert.equal(await p.locator('.scene-hero-copy [data-poem]').getAttribute('data-poem-id'),before);
  await p.reload();await p.waitForFunction(()=>document.querySelector('.scene-hero-copy [data-poem]').dataset.poemId);assert.notEqual(await p.locator('.scene-hero-copy [data-poem]').getAttribute('data-poem-id'),before);assert.equal(JSON.stringify(s.control.records),original);
  assert.equal(await p.locator('#sceneMasthead [data-poem]').count(),0);
 });
 await check('feature focus and search close in order without leaving a competing homepage layer',async()=>{
  await p.setViewportSize({width:1440,height:900});await p.locator('#sceneNavHome').click();await p.locator('#sceneSearch').fill('回忆');await p.locator('#sceneNavMemory').click();
  assert.equal(await p.locator('#sceneSearchResults').isVisible(),false);assert.equal(await p.locator('#sceneHero').isVisible(),false);assert.equal(await p.locator('#chatColumn').evaluate(e=>e.inert),true);
  await p.keyboard.press('Escape');assert.equal(await p.locator('#spaceHome').isVisible(),true);await p.keyboard.press('Escape');assert.equal(await p.locator('#relationSpace').evaluate(e=>e.inert),true);assert.equal(await p.locator('#sceneHero').isVisible(),true);
  await p.locator('#sceneNavChat').click();await p.locator('#messageInput').fill('还没有发送的草稿');await p.locator('#sceneNavMemory').click();await p.locator('#relationClose').click();assert.equal(await p.locator('#messageInput').inputValue(),'还没有发送的草稿');assert.equal(await p.locator('#chatColumn').evaluate(e=>e.inert),false);
 });
 assert.deepEqual(s.errors,[]);await s.context.close();
}
