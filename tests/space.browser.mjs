import assert from 'node:assert/strict';
export async function runSpace({setup,check,secureId,user,friend,fixture,root}){
 const rows=[fixture(1,secureId,'今天也辛苦了。',friend,{author_id:friend}),fixture(2,secureId,'好，晚安。明天见 ♡',user,{author_id:user})];
 const s=await setup({secure:true,rows}),p=s.page;
 await p.waitForFunction(()=>document.querySelector('#roomStatus').textContent.includes('左滑'));
 await check('relationship pages share one full-page framework while the conversation and draft remain mounted',async()=>{
  await p.locator('#messageInput').fill('写了一半，还想接着说。');
  for(const [button,panel] of [['[data-open-view=diary]','diarySpace'],['[data-open-view=wall]','wallSpace'],['#relationshipBtn','relationshipScrim'],['#listenBtn','listenScrim'],['#memoirBtn','memoirScrim']]){
   await p.locator('#relationHandle').click();await p.locator(button).click();
   assert.equal(await p.locator(`#relationSpace #${panel}`).isVisible(),true);
   assert.equal(await p.locator('#messages .msg').count(),2);
   assert.equal(await p.locator('#messageInput').inputValue(),'写了一半，还想接着说。');
   assert.equal(await p.locator('.scrim:visible').count(),0);
   await p.locator('#spaceBack').click();assert.equal(await p.locator('#spaceHome').isVisible(),true);
   await p.locator('#relationClose').click();
  }
 });
 await check('six themes fit phone portrait/landscape, tablet portrait/landscape and desktop',async()=>{
  for(const [device,width,height] of [['phone',390,844],['phone-wide',844,390],['tablet-tall',820,1180],['tablet-wide',1180,820],['pc',1440,900]]){
   await p.setViewportSize({width,height});
   for(const theme of ['ins-light','ins-dark','warm-light','warm-dark','rain-night','moon-glass']){
    await p.evaluate(async theme=>(await import('./ui-v2.js?v=2.7.0')).setTheme(theme),theme);
    await p.locator('#relationHandle').click();await p.locator('#relationSpace').waitFor({state:'visible'});
    await p.waitForTimeout(260);
    assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${device} ${theme}: page overflow`);
    const side=await p.locator('#relationSpace').boundingBox(),rail=await p.locator('#sceneSidebar').boundingBox();
    assert.ok(side.width<=width&&side.height<=height);
    assert.equal(await p.locator('#chatColumn').isVisible(),false,'inactive chat must not compete with the feature page');
    if(width>=700&&height>500){assert.ok(side.width>=width-260,`${device}: feature must fill the main area`);assert.ok(side.x>=rail.x+rail.width,`${device}: feature must not cover navigation`);}
    else{assert.ok(side.width>=width-2,`${device}: phone panel must fill screen`);assert.ok(side.y+side.height<=rail.y+1,'bottom navigation remains reachable');}
    if(device==='tablet-wide')assert.ok(await p.locator('#sceneSidebar').isVisible());
    if(device==='phone'&&theme==='warm-light'||device==='tablet-wide'&&theme==='moon-glass'||device==='pc'&&theme==='rain-night')await p.screenshot({path:`${root}/test-results/space-${device}-${theme}.png`});
    await p.locator('[data-open-view=diary]').click();assert.equal(await p.locator('#diaryEntries .msg').count(),2);
    assert.ok(await p.locator('#diarySpace').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    await p.locator('#relationClose').click();
   }
  }
 });
 await check('desktop navigation returns to the same draft; mobile Escape backs out of page then space',async()=>{
  await p.setViewportSize({width:1440,height:900});await p.locator('#sceneNavChat').click();await p.locator('#messageInput').fill('边看回忆，边接着聊。');await p.locator('#sceneNavMemory').click();assert.equal(await p.locator('#messageInput').isVisible(),false);await p.locator('#sceneNavChat').click();assert.equal(await p.locator('#messageInput').inputValue(),'边看回忆，边接着聊。');await p.locator('#sceneNavMemory').click();
  await p.setViewportSize({width:390,height:844});await p.keyboard.press('Escape');assert.equal(await p.locator('#spaceHome').isVisible(),true);await p.keyboard.press('Escape');await p.locator('#relationSpace').waitFor({state:'hidden'});
 });
 assert.deepEqual(s.errors,[]);await s.context.close();
}
