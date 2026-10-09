import assert from 'node:assert/strict';
export async function runNavigation({setup,check,secureId,user,friend,fixture,root}){
 const s=await setup({secure:true,startView:'home',touch:true,viewport:{width:1280,height:800},rows:Array.from({length:85},(_,i)=>fixture(i+1,secureId,'一起留下的第 '+(i+1)+' 条回忆。',i%2?friend:user,{author_id:i%2?friend:user}))}),p=s.page;
 await p.waitForFunction(()=>document.querySelector('#roomStatus').textContent.includes('左滑'));
 const snapshot=async name=>{await p.evaluate(()=>document.fonts.ready);await p.screenshot({animations:'disabled',path:root+'/test-results/navigation-'+name+'.png'});};
 await check('touch navigation works when the browser omits click, and a normal tap activates exactly once',async()=>{
  await p.evaluate(()=>{
   window.suppressSidebarClick=e=>e.preventDefault();
   document.querySelector('#sceneSidebar').addEventListener('touchstart',window.suppressSidebarClick,{passive:false});
   window.sceneViewChanges=0;document.addEventListener('mailbox:scene-view',()=>window.sceneViewChanges++);
  });
  for(const [id,route] of [['Chat','chat'],['Memory','wallSpace'],['Plan','todoSpace'],['Mail','mail'],['More','more'],['Home','home']]){
   await p.locator('#sceneNav'+id).tap();
   assert.equal(await p.locator('.scene-shell').getAttribute('data-route'),route,'pointerup must not depend on a compatibility click: '+id);
  }
  await p.evaluate(()=>document.querySelector('#sceneSidebar').removeEventListener('touchstart',window.suppressSidebarClick));
  const before=await p.evaluate(()=>window.sceneViewChanges);
  await p.locator('#sceneNavChat').tap();await p.locator('#sceneNavHome').tap();
  assert.equal(await p.evaluate(()=>window.sceneViewChanges),before+2,'a normal tap must not navigate twice');
  await p.locator('#sceneSidebarToggle').tap();assert.equal(await p.locator('.scene-shell').evaluate(e=>e.classList.contains('rail-collapsed')),true);
  await p.locator('#sceneSidebarToggle').tap();assert.equal(await p.locator('.scene-shell').evaluate(e=>e.classList.contains('rail-collapsed')),false);
 });
 await check('touch drags, cancelled gestures, two fingers and modal overlays never activate the sidebar',async()=>{
  const cdp=await s.context.newCDPSession(p);
  const box=await p.locator('#sceneNavChat').boundingBox(),x=Math.round(box.x+box.width/2),y=Math.round(box.y+box.height/2);
  const point=(id,dx=0,dy=0)=>({id,x:x+dx,y:y+dy});
  for(const mode of ['drag','cancel','two-fingers','outside']){
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(0)]});
   if(mode==='drag'){
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(0,0,30)]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(0)]});
   }else if(mode==='two-fingers')await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(0),point(1,220)]});
   else if(mode==='outside')await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(0,220)]});
   await cdp.send('Input.dispatchTouchEvent',{type:mode==='cancel'?'touchCancel':'touchEnd',touchPoints:[]});
   assert.equal(await p.locator('.scene-shell').getAttribute('data-route'),'home',mode+' must not navigate');
  }
  await p.locator('#sceneNavChat').tap();assert.equal(await p.locator('.scene-shell').getAttribute('data-route'),'chat','the next clean tap recovers after cancelled gestures');
  await p.locator('#sceneNotifications').click();await p.locator('#settingsScrim').waitFor();
  const more=await p.locator('#sceneNavMore').boundingBox();await p.touchscreen.tap(more.x+more.width/2,more.y+more.height/2);
  assert.equal(await p.locator('.scene-shell').getAttribute('data-route'),'chat','never navigate through a modal backdrop');
  if(await p.locator('#settingsScrim').isVisible())await p.keyboard.press('Escape');
  await p.locator('#sceneNavMore').tap();assert.equal(await p.locator('.scene-shell').getAttribute('data-route'),'more');
  await p.locator('#sceneNavChat').focus();await p.keyboard.press('Enter');assert.equal(await p.locator('.scene-shell').getAttribute('data-route'),'chat');
  await p.locator('#sceneNavHome').focus();await p.keyboard.press('Space');assert.equal(await p.locator('.scene-shell').getAttribute('data-route'),'home');
  await cdp.detach();
 });
 await check('content layers cannot steal sidebar taps in any theme on phone, tablet or desktop',async()=>{
  await p.evaluate(()=>{const layer=document.createElement('div');layer.id='contentLayerProbe';layer.style.cssText='position:fixed;inset:0;z-index:9999;background:transparent';document.querySelector('#room').append(layer);});
  for(const [width,height] of [[390,844],[820,1180],[1536,864],[844,390]]){
   await p.setViewportSize({width,height});
   for(const theme of ['ins-light','ins-dark','warm-light','warm-dark','rain-night','moon-glass']){
    await p.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    for(const [id,route] of [['Chat','chat'],['Memory','wallSpace'],['Mail','mail'],['More','more'],['Home','home']]){
     const button=p.locator('#sceneNav'+id),rect=await button.boundingBox();
     assert.equal(await p.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('[data-scene-nav]')?.id,{x:rect.x+rect.width/2,y:rect.y+rect.height/2}),'sceneNav'+id,'the visible sidebar owns its hit area');
     await button.tap();assert.equal(await p.locator('.scene-shell').getAttribute('data-route'),route);
    }
   }
  }
  await p.evaluate(()=>document.querySelector('#contentLayerProbe').remove());
 });
 await check('navigation swaps the full main area and remains reachable on phone, tablet and desktop',async()=>{
  for(const [width,height] of [[390,844],[820,1180],[1280,800],[844,390]]){
   await p.setViewportSize({width,height});
   for(const [id,panel] of [['chat','#chatColumn'],['memory','#relationSpace'],['plan','#relationSpace'],['more','#relationSpace'],['mail','#home']]){
    await p.locator('[data-scene-nav='+id+']').click();
    const b=await p.locator(panel).boundingBox(),rail=await p.locator('#sceneSidebar').boundingBox();
    assert.ok(b.width>(width<700||height<501?width*.96:width-240),id+' must fill the content width');
    assert.ok(b.height>height*.74,id+' must fill the content height');
    assert.ok(b.y+b.height<=height+1);assert.ok(await p.locator('#sceneNavHome').isVisible());
    assert.equal(await p.locator('[data-scene-nav='+id+']').getAttribute('aria-current'),'page');
    assert.equal(await p.evaluate(()=>document.activeElement?.dataset.sceneNav),id,'navigation must not move keyboard focus back to the previous tab');
    if(width<700||height<501)assert.ok(b.y+b.height<=rail.y+1,'bottom navigation stays outside the page');
    assert.equal(await p.locator('#sceneHero').isVisible(),false);assert.equal(await p.locator('.scene-dock').isVisible(),false);
    assert.equal(await p.locator('#sceneMasthead').isVisible(),false);
    assert.equal(await p.locator(panel+' .scene-page-header #sceneNotifications').count(),1,'the active page must own the shared settings control');
    await p.locator('#sceneNotifications').click();await p.locator('#settingsScrim').waitFor();await p.keyboard.press('Escape');assert.equal(await p.locator(panel).isVisible(),true);
   }
   await p.locator('#sceneNavMemory').click();await snapshot('memory-'+width);
  }
 });
 await check('the collapsible sidebar resizes the whole page, retains its preference and exposes accessible icon navigation',async()=>{
  await p.setViewportSize({width:1280,height:800});
  if(await p.locator('.scene-shell').evaluate(e=>e.classList.contains('rail-collapsed')))await p.locator('#sceneSidebarToggle').click();
  const expanded=await p.locator('#relationSpace').boundingBox();await p.getByRole('button',{name:'收起侧栏',exact:true}).click();
  const collapsed=await p.locator('#relationSpace').boundingBox();assert.ok(collapsed.width-expanded.width>75);assert.ok(collapsed.x<expanded.x);
  assert.equal(await p.getByRole('button',{name:'展开侧栏',exact:true}).getAttribute('aria-expanded'),'false');
  await p.getByRole('button',{name:'对话',exact:true}).click();await p.locator('#messageInput').fill('切换回来仍然保留的草稿');
  await p.reload();await p.waitForFunction(()=>document.querySelector('#roomStatus').textContent.includes('左滑'));
  assert.equal(await p.locator('.scene-shell').evaluate(e=>e.classList.contains('rail-collapsed')),true);
  await p.locator('#sceneNavMemory').click();await snapshot('collapsed');
  await p.getByRole('button',{name:'展开侧栏',exact:true}).click();await snapshot('expanded');
 });
 await check('rapid taps keep live message and memory nodes, zoom, drafts and editors without redundant data reloads',async()=>{
  await p.locator('#sceneNavMemory').click();await p.locator('.memory-card').first().waitFor();
  await p.locator('#memoryZoomIn').click();const zoom=await p.locator('#memoryZoomReset').textContent();
  await p.evaluate(()=>{window.keptMessage=document.querySelector('#messages .msg');window.keptMemory=document.querySelector('.memory-card');window.keptAudio=document.querySelector('#listenAudio');});
  const requests=[];const listener=r=>{if(/\/(?:space_entries|pockets|pocket_entries|pocket_leaves|rpc\/mailbox_listen_report|rpc\/mailbox_space_clock)(?:\?|$)/.test(r.url()))requests.push(r.url());};p.on('request',listener);
  const times=await p.evaluate(async()=>{
   const samples=[];
   for(let i=0;i<30;i++){const id=['Memory','Plan','Mail','Chat','More'][i%5],start=performance.now();document.querySelector('#sceneNav'+id).click();await new Promise(requestAnimationFrame);samples.push(performance.now()-start);}
   document.querySelector('#sceneNavMemory').click();return samples;
  });
  assert.ok(Math.max(...times)<500,'a warmed navigation must respond within 500 ms, without an animation queue');
  assert.ok(requests.length<=5,'rapid navigation must reuse recently loaded records');p.off('request',listener);
  assert.deepEqual(await p.evaluate(()=>({message:window.keptMessage===document.querySelector('#messages .msg'),memory:window.keptMemory===document.querySelector('.memory-card'),audio:window.keptAudio===document.querySelector('#listenAudio')})),{message:true,memory:true,audio:true});
  assert.equal(await p.locator('#memoryZoomReset').textContent(),zoom);
  await p.locator('#sceneNavMore').click();await p.locator('#pocketSpaceBtn').click();await p.locator('#pocketSpace .daily-toolbar button').click();
  await p.locator('#pocketSpace [name=title]').fill('还没写完的目标');await p.locator('#sceneNavChat').click();assert.equal(await p.locator('#messageInput').inputValue(),'切换回来仍然保留的草稿');
  await p.locator('#sceneNavMore').click();await p.locator('#pocketSpaceBtn').click();assert.equal(await p.locator('#pocketSpace [name=title]').inputValue(),'还没写完的目标');
  console.log('Navigation timing (ms): median='+Math.round([...times].sort((a,b)=>a-b)[15])+', max='+Math.round(Math.max(...times))+', repeated data requests='+requests.length);
 });
 await check('mobile modal close keeps the current page and reduced motion skips transition effects',async()=>{
  await p.setViewportSize({width:390,height:844});await p.locator('#sceneNavMore').click();await p.locator('#spaceSettings').click();assert.equal(await p.locator('#settingsScrim').isVisible(),true);await p.keyboard.press('Escape');assert.equal(await p.locator('#settingsScrim').isVisible(),false);assert.equal(await p.locator('.scene-shell').getAttribute('data-route'),'more');assert.equal(await p.locator('#spaceHome').isVisible(),true);
  await p.locator('#sceneNavMail').click();assert.equal(await p.locator('#themeBtn').count(),0);await p.locator('#sceneNotifications').click();await p.keyboard.press('Escape');assert.equal(await p.locator('.scene-shell').getAttribute('data-route'),'mail');assert.equal(await p.locator('#home').isVisible(),true);
  await p.emulateMedia({reducedMotion:'reduce'});await p.locator('#sceneNavChat').click();await p.locator('#sceneNavMemory').click();
  assert.equal(await p.locator('#spacePages').evaluate(e=>e.getAnimations().length),0);assert.equal(await p.locator('#sceneNavHome').isVisible(),true);
  await p.locator('#memoryZoomReset').click();await snapshot('phone');
 });
 assert.deepEqual(s.errors,[]);await s.context.close();
}
