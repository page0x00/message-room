import assert from 'node:assert/strict';
export async function runTouchLayout({setup,check,secureId,user,fixture,root}){
 const s=await setup({secure:true,startView:'home',touch:true,viewport:{width:1280,height:680},rows:[fixture(1,secureId,'一张便签',user,{author_id:user}),fixture(2,secureId,'第二张便签',user,{author_id:user})]}),p=s.page;
 await p.waitForFunction(()=>document.querySelector('#roomStatus').textContent.includes('左滑'));
 const cdp=await s.context.newCDPSession(p);
 const gesture=async(from,to)=>{await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[from]});for(let i=1;i<=12;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from.x+(to.x-from.x)*i/12,y:from.y+(to.y-from.y)*i/12}]});await p.waitForTimeout(18);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await p.waitForTimeout(150);};
 const shot=async name=>{await p.evaluate(()=>document.fonts.ready);await p.screenshot({animations:'disabled',path:root+'/test-results/report-271/'+name+'.png'});};
 const tools=async()=>{if(await p.locator('#memoryTools').isHidden())await p.locator('#memoryToolsToggle').tap();};
 const mode=async name=>{await tools();await p.locator(`[data-memory-mode=${name}]`).tap();};
 await check('touch scrolls More in both directions, removes the paper and restores its scroll position',async()=>{
  for(const [width,height] of [[1280,540],[390,620]]){
   await p.setViewportSize({width,height});await p.locator('#sceneNavMore').tap();
   assert.equal(await p.locator('#spaceHome .paper-note').count(),0);
   await p.locator('#spaceHome').evaluate(e=>e.scrollTop=0);const b=await p.locator('#spaceHome').boundingBox();
   await gesture({x:b.x+b.width*.4,y:b.y+b.height-45},{x:b.x+b.width*.4,y:b.y+50});
   const offset=await p.locator('#spaceHome').evaluate(e=>e.scrollTop);assert.ok(offset>30,'touch must scroll feature cards');
   await p.locator('#sceneNavChat').tap();await p.locator('#sceneNavMore').tap();
   assert.ok(Math.abs(await p.locator('#spaceHome').evaluate(e=>e.scrollTop)-offset)<2,'returning to More keeps the actual scroller');
   await gesture({x:b.x+b.width*.4,y:b.y+50},{x:b.x+b.width*.4,y:b.y+b.height-45});
   assert.ok(await p.locator('#spaceHome').evaluate(e=>e.scrollTop)<offset-20,'touch must scroll back up');
  }
 });
 await check('tapping a mailbox conversation opens Chat and repeated real taps never return to Home',async()=>{
  await p.setViewportSize({width:1280,height:680});await p.locator('#sceneNavMail').tap();await p.locator('#roomList .room-card').first().tap();
  assert.equal(await p.locator('.scene-shell').getAttribute('data-route'),'chat');
  await p.waitForFunction(()=>document.querySelector('#roomStatus').textContent.includes('左滑'));
  for(const origin of ['More','Memory','Mail','Home','Plan','More']){await p.locator('#sceneNav'+origin).tap();await p.locator('#sceneNavChat').tap();assert.equal(await p.locator('.scene-shell').getAttribute('data-route'),'chat');assert.equal(await p.locator('#messageInput').isVisible(),true);}
 });
 await check('API inputs stay visible with a tablet keyboard, and Chat stays visible with a phone keyboard',async()=>{
  await p.locator('#sceneNavMore').tap();await p.locator('#apiSpaceBtn').tap();await p.waitForFunction(()=>!document.querySelector('#apiFields').disabled);await p.locator('#apiName').focus();
  await p.setViewportSize({width:1280,height:266});await p.waitForFunction(()=>document.documentElement.classList.contains('keyboard-open'));
  const visible=async selector=>{await p.locator(selector).focus();await p.waitForTimeout(100);const b=await p.locator(selector).boundingBox(),head=await p.locator('.relation-head').boundingBox();assert.ok(b.y>=head.y+head.height-1,selector+' must be below the header');assert.ok(b.y+b.height<=266,selector+' must be above the keyboard');};
  await visible('#apiName');await p.locator('#apiName').fill('键盘输入检查');await visible('#apiBase');await visible('#apiKey');
  assert.equal(await p.locator('#sceneSidebar').isVisible(),false);await shot('tablet-keyboard');
  await p.setViewportSize({width:1280,height:680});await p.waitForFunction(()=>!document.documentElement.classList.contains('keyboard-open'));assert.equal(await p.locator('#sceneSidebar').isVisible(),true);
  await p.locator('#sceneNavChat').tap();await p.setViewportSize({width:390,height:844});await p.locator('#messageInput').focus();await p.locator('#messageInput').fill('键盘弹起后继续输入');
  await p.setViewportSize({width:390,height:300});await p.waitForFunction(()=>document.documentElement.classList.contains('keyboard-open'));
  const b=await p.locator('#messageInput').boundingBox();assert.ok(b.y>=0&&b.y+b.height<=300);assert.equal(await p.locator('#sceneSidebar').isVisible(),false);await shot('phone-keyboard');
  await p.setViewportSize({width:390,height:844});await p.waitForFunction(()=>!document.documentElement.classList.contains('keyboard-open'));await p.locator('#sceneNavMore').tap();await p.locator('#sceneNavChat').tap();assert.equal(await p.locator('#messageInput').inputValue(),'键盘弹起后继续输入');
 });
 await check('visual-viewport-only keyboard resizing also keeps a focused input inside the visible frame',async()=>{
  await p.setViewportSize({width:1280,height:680});await p.locator('#sceneNavMore').tap();await p.locator('#apiSpaceBtn').tap();await p.waitForFunction(()=>!document.querySelector('#apiFields').disabled);await p.locator('#apiKey').focus();
  await p.evaluate(()=>{Object.defineProperties(visualViewport,{height:{configurable:true,value:280},offsetTop:{configurable:true,value:24}});visualViewport.dispatchEvent(new Event('resize'));});
  await p.waitForFunction(()=>document.documentElement.classList.contains('keyboard-open'));await p.waitForTimeout(100);
  const b=await p.locator('#apiKey').boundingBox();assert.ok(b.y>=68&&b.y+b.height<=304);assert.equal(await p.locator('#sceneSidebar').isVisible(),false);
  await p.evaluate(()=>{delete visualViewport.height;delete visualViewport.offsetTop;visualViewport.dispatchEvent(new Event('resize'));});await p.waitForFunction(()=>!document.documentElement.classList.contains('keyboard-open'));
 });
 await check('wall tools float over the canvas, match all six themes, and no longer reserve two rows',async()=>{
  await p.setViewportSize({width:1280,height:680});await p.locator('#sceneNavMemory').tap();await p.locator('.memory-card').first().waitFor();
  const stage=await p.locator('.memory-stage').boundingBox(),header=await p.locator('.relation-head').boundingBox();assert.ok(stage.y<=header.y+header.height+2);assert.equal(await p.locator('#memoryTools').isHidden(),true);
  for(const theme of ['ins-light','ins-dark','warm-light','warm-dark','rain-night','moon-glass']){
   await p.evaluate(async theme=>(await import('./ui-v2.js?v=2.7.2')).setTheme(theme),theme);await tools();
   const expanded=await p.locator('.memory-stage').boundingBox();assert.deepEqual(expanded,stage,'opening tools must not shrink the wall');
   const colors=await p.locator('#memoryTools').evaluate(e=>({background:getComputedStyle(e).backgroundColor,text:getComputedStyle(e).color}));assert.notEqual(colors.background,colors.text);
   await p.locator('[aria-label="收起回忆工具"]').tap();
  }
  await p.evaluate(async()=>(await import('./ui-v2.js?v=2.7.2')).setTheme('warm-dark'));await tools();await shot('wall-tools');await p.locator('[aria-label="收起回忆工具"]').tap();await mode('disc');await shot('wall-disc');await mode('board');await shot('wall-board');
 });
 await check('a clue card reaches all four canvas corners after resize and zoom and retains its position',async()=>{
  const card=p.locator('[data-memory-id="message:1"]');
  for(const [width,height,zoom] of [[1280,680,1],[1280,840,1],[820,720,.5]]){
   await p.setViewportSize({width,height});await p.waitForTimeout(120);await p.locator('#memoryZoomReset').tap();
   if(zoom===.5)for(let i=0;i<4;i++)await p.locator('#memoryZoomOut').tap();
   const scale=Number(await p.locator('.memory-stage').getAttribute('data-zoom'))/100;
   const stage=await p.locator('.memory-stage').boundingBox(),canvas=await p.locator('.clue-canvas').boundingBox();
   if(zoom===1)assert.ok(Math.abs(canvas.height-(stage.height-12))<2,'few cards use exactly the visible inner height');
   for(const [x,y] of [[1,1],[0,1],[0,0],[1,0]]){
    const b=await card.boundingBox();
    // Drag from the centre of a visible card to a board corner, clamped by its real size.
    const from={x:b.x+b.width/2,y:b.y+Math.min(b.height/2,80*scale)};
    const to={x:x?canvas.x+canvas.width-2:canvas.x+2,y:y?canvas.y+canvas.height-2:canvas.y+2};
    await gesture(from,to);
    const pos=await card.evaluate(e=>{const c=e.closest('.clue-canvas');return {x:e.offsetLeft,y:e.offsetTop,right:c.clientWidth-e.offsetLeft-e.offsetWidth,bottom:c.clientHeight-e.offsetTop-e.offsetHeight};});
    assert.ok(x?pos.right<=10:pos.x<=10,JSON.stringify({width,height,x,y,pos}));assert.ok(y?pos.bottom<=10:pos.y<=14,JSON.stringify({width,height,x,y,pos}));
   }
  }
  await p.locator('#sceneNavChat').tap();await p.locator('#sceneNavMemory').tap();assert.equal(await card.isVisible(),true);assert.ok(s.control.memoryProfiles[0].data.positions['message:1']);
  await shot('board-zoom');
 });
 assert.deepEqual(s.errors,[]);await s.context.close();
 const legacy=await setup({secure:false,startView:'home',touch:true,viewport:{width:1280,height:680}});
 await check('legacy mailbox conversations also enter Chat directly',async()=>{await legacy.page.locator('#sceneNavMail').tap();await legacy.join();assert.equal(await legacy.page.locator('.scene-shell').getAttribute('data-route'),'chat');await legacy.page.locator('#sceneNavMail').tap();await legacy.page.locator('#roomList .room-card').first().tap();assert.equal(await legacy.page.locator('.scene-shell').getAttribute('data-route'),'chat');});
 assert.deepEqual(legacy.errors,[]);await legacy.context.close();
}
