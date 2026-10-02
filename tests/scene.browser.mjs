import assert from 'node:assert/strict';
export async function runScene({setup,check,secureId,user,friend,fixture,root}){
 const themes=['ins-light','ins-dark','warm-light','warm-dark','rain-night','moon-glass'];
 const s=await setup({secure:true,startView:'home',viewport:{width:1536,height:1024},rows:[fixture(1,secureId,'今天窗边的光，想分给你一点。',user,{author_id:user}),fixture(2,secureId,'等雨停下，我们去散步吧。',friend,{author_id:friend})]}),p=s.page;
 await p.waitForFunction(()=>document.querySelector('#roomStatus').textContent.includes('左滑'));
 for(const [i,title] of ['一起读两页飞鸟集','记得好好吃晚饭','整理今天的照片','晚风里散步','早点休息'].entries())s.control.daily.space_entries.push({id:'scene-todo-'+i,revision:1,room_id:secureId,owner_user_id:user,kind:'todo',title,body:'',visibility:'shared',event_date:'2026-10-03',created_at:'2026-10-02T20:00:00Z',data:{done:i<2,remind:false}});
 await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
 await p.waitForFunction(()=>document.querySelectorAll('#sceneTodoList .scene-todo').length===5);
 const theme=async t=>p.evaluate(async t=>(await import('./ui-v2.js?v=2.4.2')).setTheme(t),t);
 const snapshot=async name=>{await p.evaluate(()=>document.fonts.ready);await p.screenshot({path:root+'/test-results/scene-'+name+'.png'});};
 await check('all six themes share the reference layout at desktop, short tablet and phone sizes',async()=>{
  assert.equal(await p.locator('#sceneHero').isVisible(),true);
  for(const [width,height] of [[1536,1024],[1180,630],[1024,600],[820,1180],[390,844],[844,390]]){
   await p.setViewportSize({width,height});let first;
   for(const t of themes){
    await theme(t);await p.evaluate(()=>document.fonts.ready);
    const bounds=await p.evaluate(()=>Object.fromEntries(['#sceneSidebar','#sceneMasthead','#sceneHero','.scene-music','.scene-todos','.scene-shortcuts','#sceneFilmOpen'].map(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return[selector,[r.x,r.y,r.width,r.height].map(n=>Math.round(n*10)/10)];})));
    if(first)assert.deepEqual(bounds,first,`${width}×${height}: ${t} moved a shared region`);else first=bounds;
    assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${t}: page overflow`);
    assert.equal(await p.locator('.scene-dock').isVisible(),true);
    if(width>=980&&height>500){assert.ok(bounds['.scene-music'][0]>bounds['#sceneHero'][0]+bounds['#sceneHero'][2]);assert.ok(bounds['.scene-music'][1]<bounds['.scene-todos'][1]);assert.ok(bounds['#sceneFilmOpen'][1]+bounds['#sceneFilmOpen'][3]<=height);assert.ok(bounds['.scene-music'][3]>=150);}
    if(width<700){assert.ok(bounds['.scene-music'][1]>=bounds['#sceneHero'][1]+bounds['#sceneHero'][3]);assert.ok(bounds['.scene-todos'][1]>=bounds['.scene-music'][1]+bounds['.scene-music'][3]);assert.ok(bounds['.scene-shortcuts'][1]>=bounds['.scene-todos'][1]+bounds['.scene-todos'][3]);assert.ok(bounds['#sceneFilmOpen'][1]>=bounds['.scene-shortcuts'][1]+bounds['.scene-shortcuts'][3]);}
    if(width===1536||width===1180||width===390&&t==='moon-glass')await snapshot(`${width}-${t}`);
   }
  }
 });
 await check('home, chat, inbox and feature navigation preserve live nodes and the draft',async()=>{
  await p.setViewportSize({width:1440,height:900});await p.locator('#sceneNavChat').click();await p.locator('#messageInput').fill('写到一半，还想慢慢讲给你听。');
  await p.evaluate(()=>{window.sceneAudio=document.querySelector('#listenAudio');window.sceneMessages=document.querySelector('#messages');});
  await p.locator('#sceneNavHome').click();await p.locator('#sceneNavMemory').click();assert.equal(await p.locator('#wallSpace').isVisible(),true);assert.equal(await p.locator('#sceneHero').isVisible(),true);await p.locator('#relationClose').click();
  await p.locator('#sceneNavMail').click();assert.equal(await p.locator('#home').isVisible(),true);await p.locator('#sceneInboxClose').click();
  await p.locator('#sceneNavChat').click();assert.equal(await p.locator('#messageInput').inputValue(),'写到一半，还想慢慢讲给你听。');assert.equal(await p.locator('#messages .msg').count(),2);assert.ok(await p.evaluate(()=>window.sceneAudio===document.querySelector('#listenAudio')&&window.sceneMessages===document.querySelector('#messages')));
  await p.locator('#sceneSearch').fill('散步');await p.locator('#sceneSearchResults button').click();assert.equal(await p.locator('#messages .quote-highlight').count(),1);
  await p.locator('#sceneSearch').fill('荷包');await p.locator('#sceneSearchResults button').click();assert.equal(await p.locator('#pocketSpace').isVisible(),true);await p.locator('#relationClose').click();
  await p.locator('#sceneNavHome').click();await p.locator('#sceneTodoList').getByRole('checkbox',{name:'早点休息',exact:true}).click();await p.waitForFunction(()=>document.querySelector('#sceneTodoCount').textContent==='3/5');assert.equal(s.control.daily.space_entries.at(-1).data.done,true);
  await p.locator('#sceneTodoList').getByRole('checkbox',{name:'早点休息',exact:true}).click();await p.waitForFunction(()=>document.querySelector('#sceneTodoCount').textContent==='2/5');assert.equal(s.control.daily.space_entries.at(-1).data.done,false);
  s.control.records.push(fixture(3,secureId,'首页也要留住未读提醒',friend,{author_id:friend,created_at:new Date(Date.now()+1000).toISOString()}));await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await p.waitForFunction(()=>document.title.startsWith('(1)'));await p.locator('#sceneNavChat').click();await p.locator('#messages').evaluate(el=>el.scrollTop=el.scrollHeight);await p.waitForFunction(()=>!document.title.startsWith('('));await p.locator('#sceneNavHome').click();
 });
 await check('the landing page offers real room entry and phone navigation remains usable',async()=>{
  const landing=await setup({startView:'home'});assert.equal(await landing.page.locator('#sceneHero').isVisible(),true);await landing.page.locator('#sceneWrite').click();assert.equal(await landing.page.locator('#home').isVisible(),true);assert.equal(await landing.page.locator('#addRoomBtn').isVisible(),true);await landing.context.close();
  await p.setViewportSize({width:390,height:844});await p.locator('.scene-search').click();await p.locator('#sceneSearch').fill('日记');await p.locator('#sceneSearchResults button').click();assert.equal(await p.locator('#diarySpace').isVisible(),true);await p.locator('#relationClose').click();await p.locator('#sceneNavChat').click();assert.equal(await p.locator('#composer').isVisible(),true);await p.locator('#sceneNavMore').click();assert.equal(await p.locator('#spaceHome').isVisible(),true);await p.locator('#relationClose').click();await p.locator('#sceneNavHome').click();await p.locator('#sceneFilmOpen').click();assert.equal(await p.locator('#filmSpace').isVisible(),true);await p.locator('#relationClose').click();
 });
 s.control.denyJoin=true;await p.reload();await p.locator('#connectionNote').waitFor({state:'visible'});assert.match(await p.locator('#connectionNote').textContent(),/没有访问权限/);assert.equal(await p.locator('#sceneHero').isVisible(),false);
 assert.deepEqual(s.errors,[]);await s.context.close();
}
