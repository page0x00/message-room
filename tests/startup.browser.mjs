import assert from 'node:assert/strict';

export async function runStartup({setup,check,root,user,friend}){
 const s=await setup({startView:'home',touch:true,viewport:{width:1280,height:800}}),p=s.page;
 const base=new URL('.',p.url()).href;
 const route=()=>p.locator('.scene-shell').getAttribute('data-route');
 const ready=()=>p.waitForFunction(()=>document.documentElement.dataset.appState==='ready');
 await check('first-visit navigation explains room selection and preserves the latest destination',async()=>{
  await p.locator('#sceneNavMore').tap();assert.equal(await route(),'more');
  await p.locator('#apiSpaceBtn').tap();assert.equal(await route(),'apiSettingsScrim');
  await p.locator('#sceneNavChat').tap();assert.match(await p.locator('#sceneRoomPrompt').textContent(),/打开对话/);
  await p.locator('#sceneNavMemory').tap();assert.match(await p.locator('#sceneRoomPrompt').textContent(),/打开回忆墙/);
  await s.join();assert.equal(await route(),'wallSpace');
  assert.equal(await p.evaluate(user=>JSON.parse(localStorage.getItem('mailbox.activeRoom.'+user)),user),'OldRoom1');
 });
 await check('the production root restores the visited room and every sidebar target responds on touch screens',async()=>{
  await p.goto(base);await ready();await p.waitForFunction(()=>document.querySelector('#roomStatus').textContent.includes('左滑'));
  assert.equal(new URL(p.url()).searchParams.get('room'),'OldRoom1');assert.equal(await route(),'home');
  for(const size of [{width:1280,height:800},{width:820,height:1180},{width:390,height:844}]){
   await p.setViewportSize(size);
   for(const [nav,target] of [['Chat','chat'],['Memory','wallSpace'],['Plan','todoSpace'],['More','more'],['Mail','mail'],['Home','home']]){
    await p.locator('#sceneNav'+nav).tap();assert.equal(await route(),target);
   }
  }
  await p.setViewportSize({width:1280,height:800});
  await p.evaluate(()=>document.fonts.ready);await p.screenshot({path:root+'/test-results/startup-root.png'});
 });
 await check('old recent-room records migrate without selecting an unvisited server membership',async()=>{
  await p.evaluate(user=>{
   const visited=JSON.parse(localStorage.getItem('mailbox.recent.'+user))[0];
   localStorage.removeItem('mailbox.activeRoom.'+user);
   localStorage.setItem('mailbox.recent.'+user,JSON.stringify([{room:'UnvisitedRoom',visited:Date.now(),secure:false},visited]));
  },user);
  await p.goto(base);await p.waitForFunction(()=>document.querySelector('#roomStatus').textContent.includes('左滑'));
  assert.equal(new URL(p.url()).searchParams.get('room'),'OldRoom1');
 });
 await check('delayed authentication honors the latest sidebar choice instead of returning to Home',async()=>{
  for(const destination of ['Memory','Mail']){
   let release,started;const gate=new Promise(r=>release=r),requested=new Promise(r=>started=r);
   const delay=async request=>{started();await gate;await request.fallback();};await s.context.route('**/auth/v1/token?*',delay);
   await p.evaluate(()=>{const key='sb-yuzgbxeprpohlakxjcut-auth-token',auth=JSON.parse(localStorage.getItem(key));auth.expires_at=1;localStorage.setItem(key,JSON.stringify(auth));});
   await p.goto(base,{waitUntil:'domcontentloaded'});await ready();await requested;
   await p.locator('#sceneNavMemory').tap();
   if(destination==='Mail')await p.locator('#sceneNavMail').tap();
   release();await s.context.unroute('**/auth/v1/token?*',delay);
   await p.waitForFunction(()=>!document.querySelector('#accountSignout').hidden);
   if(destination==='Memory'){
    await p.waitForFunction(()=>document.querySelector('#roomStatus').textContent.includes('左滑'));
    assert.equal(await route(),'wallSpace');
   }else{
    // Give the membership response a chance to arrive; it must not steal focus.
    await p.waitForTimeout(200);assert.equal(await route(),'mail');assert.equal(new URL(p.url()).searchParams.get('room'),null);
    await p.locator('#roomList .room-card').filter({hasText:'留言室'}).first().tap();
    await p.waitForFunction(()=>document.querySelector('#roomStatus').textContent.includes('左滑'));
   }
  }
 });
 await check('all six saved themes remain identical before and after slow application startup',async()=>{
  for(const theme of ['ins-light','ins-dark','warm-light','warm-dark','rain-night','moon-glass']){
   await p.evaluate(theme=>{localStorage.setItem('mailbox.theme',JSON.stringify(theme));localStorage.setItem('theme.v2',theme==='ins-light'?'warm-dark':'ins-light');},theme);
   let release;const gate=new Promise(r=>release=r);
   const delay=async request=>{await gate;await request.continue();};await s.context.route('**/app.js?*',delay);
   await p.reload({waitUntil:'commit'});
   await p.locator('#appStartup').waitFor();
   assert.equal(await p.locator('html').getAttribute('data-theme'),theme);
   assert.equal(await p.locator('.app-shell').isVisible(),false,'old inbox markup must never paint while modules load');
   assert.equal(await p.locator('.app-shell').evaluate(el=>getComputedStyle(el).pointerEvents),'none');
   if(theme==='warm-dark'){await p.evaluate(()=>document.fonts.ready);await p.screenshot({path:root+'/test-results/startup-loading.png'});}
   release();await ready();await s.context.unroute('**/app.js?*',delay);
   assert.equal(await p.locator('html').getAttribute('data-theme'),theme);
   assert.equal(await p.locator('#appStartup').isVisible(),false);
   await p.locator('#sceneNavMore').tap();assert.equal(await route(),'more');
  }
 });
 await check('a malformed theme preference recovers the legacy theme without changing it after paint',async()=>{
  await p.evaluate(()=>{localStorage.setItem('mailbox.theme','{broken');localStorage.setItem('theme.v2','warm');});
  await p.reload();await ready();assert.equal(await p.locator('html').getAttribute('data-theme'),'warm-light');
  await p.evaluate(()=>{localStorage.setItem('mailbox.theme',JSON.stringify('clean'));localStorage.setItem('theme.v2','warm-dark');});
  await p.reload();await ready();assert.equal(await p.locator('html').getAttribute('data-theme'),'warm-dark');
 });
 await check('a failed module displays a usable retry instead of a frozen or obsolete interface',async()=>{
  const fail=request=>request.abort('failed');await s.context.route('**/app.js?*',fail);
  await p.reload({waitUntil:'domcontentloaded'});
  await p.locator('#startupRetry').waitFor();assert.equal(await p.locator('.app-shell').isVisible(),false);
  assert.match(await p.locator('#startupStatus').textContent(),/未能加载/);
  await s.context.unroute('**/app.js?*',fail);await p.locator('#startupRetry').tap();await ready();
  await p.locator('#sceneNavChat').tap();assert.equal(await route(),'chat');
 });
 await check('explicit room exit and account-scoped history prevent unwanted room restoration',async()=>{
  await p.locator('#backBtn').tap();assert.equal(await route(),'mail');
  await p.goto(base);await ready();assert.equal(new URL(p.url()).searchParams.get('room'),null);
  await p.locator('#sceneNavChat').tap();assert.equal(await route(),'mail');assert.equal(await p.locator('#sceneRoomPrompt').isVisible(),true);
  await p.evaluate(({user,friend})=>{
   localStorage.removeItem('mailbox.activeRoom.'+user);localStorage.removeItem('mailbox.recent.'+user);
   localStorage.setItem('mailbox.activeRoom.'+friend,JSON.stringify('FriendsRoom'));
   localStorage.setItem('mailbox.recent.'+friend,JSON.stringify([{room:'FriendsRoom',preview:'Other account'}]));
  },{user,friend});
  await p.goto(base);await ready();assert.equal(new URL(p.url()).searchParams.get('room'),null);
  await p.locator('#sceneNavMore').tap();await p.locator('#listenBtn').tap();
  assert.equal(await route(),'mail');assert.match(await p.locator('#sceneRoomPrompt').textContent(),/一起听/);
  await s.join();assert.equal(await route(),'listenScrim');
 });
 assert.deepEqual(s.errors,[]);await s.context.close();
}
